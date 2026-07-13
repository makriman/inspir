const pendingVectorWriteStaleMs = 15 * 60 * 1_000;

const exactVectorIdSql = `case
  when embedding like '"p:m:%"' or embedding like '"p:t:%"'
    then substr(embedding, 4, length(embedding) - 4)
  when embedding like '"m:%"' or embedding like '"t:%"'
    then substr(embedding, 2, length(embedding) - 2)
  else null
end`;

const cleanupOutboxConflictSql = `on conflict(vector_id) do update set
  source_row_revision = excluded.source_row_revision,
  write_token = null,
  reason = excluded.reason,
  state = excluded.state,
  write_fence_expires_at = excluded.write_fence_expires_at,
  absence_count = 0,
  lease_token = null,
  lease_until = 0,
  next_attempt_at = excluded.next_attempt_at,
  last_error = null,
  updated_at = excluded.updated_at
where memory_vector_cleanup_outbox.owner_user_id = excluded.owner_user_id
  and memory_vector_cleanup_outbox.source_namespace is excluded.source_namespace
  and memory_vector_cleanup_outbox.source_row_id is excluded.source_row_id`;

/**
 * The owner sweep may remove vector source rows only after every legacy and
 * exact identity selected by the five capture statements belongs to the same
 * owner/source row in the durable outbox. A foreign vector-id collision makes
 * this predicate false, retaining both the source and its disposable owner.
 */
export const disposableOwnerVectorCaptureReadySql = `not exists (
  select 1
  from (
    select 'user_memories:' || id as vectorId,
           user_id as ownerUserId,
           'user_memories' as sourceNamespace,
           id as sourceRowId
    from user_memories where user_id = ?1
    union all
    select ${exactVectorIdSql} as vectorId,
           user_id as ownerUserId,
           'user_memories' as sourceNamespace,
           id as sourceRowId
    from user_memories
    where user_id = ?1 and ${exactVectorIdSql} is not null
    union all
    select 'chat_memory_turns:' || id as vectorId,
           user_id as ownerUserId,
           'chat_memory_turns' as sourceNamespace,
           id as sourceRowId
    from chat_memory_turns where user_id = ?1
    union all
    select ${exactVectorIdSql} as vectorId,
           user_id as ownerUserId,
           'chat_memory_turns' as sourceNamespace,
           id as sourceRowId
    from chat_memory_turns
    where user_id = ?1 and ${exactVectorIdSql} is not null
    union all
    select 'chat_memory_summaries:' || chat_id as vectorId,
           user_id as ownerUserId,
           null as sourceNamespace,
           chat_id as sourceRowId
    from chat_memory_summaries where user_id = ?1
  ) expected
  where not exists (
    select 1
    from memory_vector_cleanup_outbox captured
    where captured.vector_id = expected.vectorId
      and captured.owner_user_id = expected.ownerUserId
      and captured.source_namespace is expected.sourceNamespace
      and captured.source_row_id is expected.sourceRowId
  )
)`;

function ownerCleanupOutboxStatement(
  db: D1Database,
  input: {
    selectionSql: string;
    userId: string;
    reason: string;
    now: number;
  },
) {
  const fenceExpiresAt = input.now + pendingVectorWriteStaleMs;
  return db.prepare(
    `insert into memory_vector_cleanup_outbox (
       vector_id, owner_user_id, source_namespace, source_row_id,
       source_row_revision, write_token, reason, state,
       write_fence_expires_at, absence_count, attempt_count,
       next_attempt_at, last_attempt_at, last_error, created_at, updated_at
     )
     select selected.vectorId, selected.ownerUserId,
            selected.sourceNamespace, selected.sourceRowId,
            selected.sourceRowRevision, null, ?1, selected.state,
            case when selected.state = 'cleanup_fenced' then ?3 else null end,
            0, 0,
            case when selected.state = 'cleanup_fenced' then ?3 else ?2 end,
            null, null, ?2, ?2
     from (${input.selectionSql}) selected
     where length(selected.vectorId) between 1 and 64
     ${cleanupOutboxConflictSql}`,
  ).bind(input.reason, input.now, fenceExpiresAt, input.userId);
}

export function disposableOwnerVectorCleanupStatements(
  db: D1Database,
  input: { userId: string; now: number },
) {
  const reason = "disposable_validation_cleanup";
  return [
    ownerCleanupOutboxStatement(db, {
      ...input,
      reason,
      selectionSql: `select 'user_memories:' || id as vectorId,
        user_id as ownerUserId, 'user_memories' as sourceNamespace,
        id as sourceRowId, updated_at as sourceRowRevision,
        'cleanup_ready' as state
        from user_memories where user_id = ?4`,
    }),
    ownerCleanupOutboxStatement(db, {
      ...input,
      reason,
      selectionSql: `select ${exactVectorIdSql} as vectorId,
        user_id as ownerUserId, 'user_memories' as sourceNamespace,
        id as sourceRowId, updated_at as sourceRowRevision,
        case when embedding like '"p:m:%"'
          then 'cleanup_fenced' else 'cleanup_ready' end as state
        from user_memories
        where user_id = ?4 and ${exactVectorIdSql} is not null`,
    }),
    ownerCleanupOutboxStatement(db, {
      ...input,
      reason,
      selectionSql: `select 'chat_memory_turns:' || id as vectorId,
        user_id as ownerUserId, 'chat_memory_turns' as sourceNamespace,
        id as sourceRowId, null as sourceRowRevision,
        'cleanup_ready' as state
        from chat_memory_turns where user_id = ?4`,
    }),
    ownerCleanupOutboxStatement(db, {
      ...input,
      reason,
      selectionSql: `select ${exactVectorIdSql} as vectorId,
        user_id as ownerUserId, 'chat_memory_turns' as sourceNamespace,
        id as sourceRowId, null as sourceRowRevision,
        case when embedding like '"p:t:%"'
          then 'cleanup_fenced' else 'cleanup_ready' end as state
        from chat_memory_turns
        where user_id = ?4 and ${exactVectorIdSql} is not null`,
    }),
    ownerCleanupOutboxStatement(db, {
      ...input,
      reason,
      selectionSql: `select 'chat_memory_summaries:' || chat_id as vectorId,
        user_id as ownerUserId, null as sourceNamespace,
        chat_id as sourceRowId, null as sourceRowRevision,
        'cleanup_ready' as state
        from chat_memory_summaries where user_id = ?4`,
    }),
  ];
}

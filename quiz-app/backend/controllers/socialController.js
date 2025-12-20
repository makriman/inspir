import { supabase } from '../utils/supabaseClient.js';

function nowIso() {
  return new Date().toISOString();
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

function randomJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

async function createUniqueJoinCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomJoinCode();
    const { data, error } = await supabase.from('study_groups').select('id').eq('join_code', code).limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return code;
  }
  throw new Error('Failed to generate unique join code');
}

// =========================
// Study groups
// =========================

export async function createStudyGroup(req, res) {
  try {
    const userId = req.user.id;
    const name = req.body?.name ? String(req.body.name).trim().slice(0, 120) : '';
    const description = req.body?.description ? String(req.body.description).slice(0, 500) : null;
    const isPrivate = Boolean(req.body?.is_private);
    if (!name) return res.status(400).json({ error: 'name is required' });

    const joinCode = await createUniqueJoinCode();
    const { data: group, error } = await supabase
      .from('study_groups')
      .insert({ owner_user_id: userId, join_code: joinCode, name, description, is_private: isPrivate })
      .select()
      .single();
    if (error) throw error;

    await supabase.from('study_group_memberships').upsert(
      { group_id: group.id, user_id: userId, role: 'owner', joined_at: nowIso() },
      { onConflict: 'group_id,user_id' }
    );

    res.json({ success: true, group });
  } catch (error) {
    console.error('Create study group error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
}

export async function joinStudyGroup(req, res) {
  try {
    const userId = req.user.id;
    const code = req.params.joinCode ? String(req.params.joinCode).trim().toUpperCase() : '';
    if (!code) return res.status(400).json({ error: 'joinCode is required' });

    const { data: group, error } = await supabase.from('study_groups').select('*').eq('join_code', code).single();
    if (error || !group) return res.status(404).json({ error: 'Group not found' });

    const { error: upsertError } = await supabase
      .from('study_group_memberships')
      .upsert({ group_id: group.id, user_id: userId, role: 'member', joined_at: nowIso() }, { onConflict: 'group_id,user_id' });
    if (upsertError) throw upsertError;

    res.json({ success: true, group });
  } catch (error) {
    console.error('Join study group error:', error);
    res.status(500).json({ error: 'Failed to join group' });
  }
}

export async function listMyStudyGroups(req, res) {
  try {
    const userId = req.user.id;
    const { data: memberships, error } = await supabase
      .from('study_group_memberships')
      .select('group_id, role, joined_at')
      .eq('user_id', userId)
      .order('joined_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const groupIds = (memberships || []).map((m) => m.group_id);
    if (groupIds.length === 0) return res.json({ success: true, groups: [] });

    const groupsRes = await supabase
      .from('study_groups')
      .select('*')
      .in('id', groupIds)
      .order('created_at', { ascending: false });
    if (groupsRes.error) throw groupsRes.error;

    const roleByGroup = new Map((memberships || []).map((m) => [m.group_id, m.role]));
    res.json({
      success: true,
      groups: (groupsRes.data || []).map((g) => ({ ...g, my_role: roleByGroup.get(g.id) || 'member' })),
    });
  } catch (error) {
    console.error('List study groups error:', error);
    res.status(500).json({ error: 'Failed to load groups' });
  }
}

export async function getStudyGroup(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data: membership, error: membershipError } = await supabase
      .from('study_group_memberships')
      .select('id')
      .eq('group_id', id)
      .eq('user_id', userId)
      .single();
    if (membershipError || !membership) return res.status(403).json({ error: 'Not a member' });

    const groupRes = await supabase.from('study_groups').select('*').eq('id', id).single();
    if (groupRes.error) throw groupRes.error;

    const membersRes = await supabase
      .from('study_group_memberships')
      .select('user_id, role, joined_at')
      .eq('group_id', id);
    if (membersRes.error) throw membersRes.error;

    res.json({
      success: true,
      group: groupRes.data,
      memberCount: membersRes.data?.length || 0,
      members: membersRes.data || [],
    });
  } catch (error) {
    console.error('Get study group error:', error);
    res.status(500).json({ error: 'Failed to load group' });
  }
}

// =========================
// Resource sharing
// =========================

export async function listResources(req, res) {
  try {
    const groupId = req.query.group_id ? String(req.query.group_id) : null;
    const limit = Math.min(200, Math.max(1, safeInt(req.query.limit, 50)));

    let query = supabase
      .from('shared_resources')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (groupId) query = query.eq('group_id', groupId);

    const { data, error } = await query;
    if (error) throw error;

    const userIds = Array.from(new Set((data || []).map((r) => r.user_id))).filter(Boolean);
    let usersById = new Map();
    if (userIds.length > 0) {
      const usersRes = await supabase.from('users').select('id, username').in('id', userIds);
      if (!usersRes.error) usersById = new Map((usersRes.data || []).map((u) => [u.id, u.username]));
    }

    res.json({
      success: true,
      resources: (data || []).map((r) => ({ ...r, username: usersById.get(r.user_id) || 'Anonymous' })),
    });
  } catch (error) {
    console.error('List resources error:', error);
    res.status(500).json({ error: 'Failed to load resources' });
  }
}

export async function createResource(req, res) {
  try {
    const userId = req.user.id;
    const title = req.body?.title ? String(req.body.title).trim().slice(0, 200) : '';
    const url = req.body?.url ? String(req.body.url).trim().slice(0, 2000) : '';
    const description = req.body?.description ? String(req.body.description).slice(0, 1000) : null;
    const tags = normalizeTags(req.body?.tags);
    const groupId = req.body?.group_id ? String(req.body.group_id) : null;

    if (!title || !url) return res.status(400).json({ error: 'title and url are required' });
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must start with http:// or https://' });

    if (groupId) {
      const membership = await supabase
        .from('study_group_memberships')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();
      if (membership.error || !membership.data) return res.status(403).json({ error: 'Not a member of this group' });
    }

    const { data, error } = await supabase
      .from('shared_resources')
      .insert({ user_id: userId, group_id: groupId, title, url, description, tags })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, resource: data });
  } catch (error) {
    console.error('Create resource error:', error);
    res.status(500).json({ error: 'Failed to create resource' });
  }
}

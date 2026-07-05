import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, PencilLine, XCircle } from "lucide-react";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import {
  editableMemoryText,
  memoryCategoryOptions,
  type MemoryItem,
  type MemoryUpdateInput,
} from "@/components/chat/memory-model";

export function MemoryItemEditor({
  memory,
  saving,
  onUpdate,
  onDelete,
  t,
}: {
  memory: MemoryItem;
  saving: boolean;
  onUpdate: (memoryId: string, input: MemoryUpdateInput) => void;
  onDelete: (memoryId: string) => void;
  t: UiTranslator;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftCategory, setDraftCategory] = useState(memory.category || "general");

  function save() {
    const next = draft.trim();
    const categoryChanged = draftCategory !== memory.category;
    const contentChanged = next && next !== memory.content && next !== memory.displayContent;
    if (!contentChanged && !categoryChanged) {
      setEditing(false);
      setDraft(editableMemoryText(memory));
      setDraftCategory(memory.category || "general");
      return;
    }
    onUpdate(memory.id, {
      ...(contentChanged ? { content: next } : {}),
      ...(categoryChanged ? { category: draftCategory } : {}),
    });
    setEditing(false);
  }

  return (
    <article className="inspir-memory-item">
      {editing ? (
        <>
          <textarea
            aria-label={t("Saved memory")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="inspir-memory-edit"
            rows={3}
            maxLength={600}
          />
          <select
            aria-label={t("Memory category")}
            value={draftCategory}
            disabled={saving}
            className="inspir-memory-edit-category"
            onChange={(event) => setDraftCategory(event.target.value)}
          >
            {memoryCategoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className={memory.doNotMention ? "is-muted-memory" : undefined}>{memory.displayContent ?? memory.content}</p>
      )}
      <div className="inspir-memory-item-meta">
        <span>
          {memory.sourceLabel ? t(memory.sourceLabel) : memory.kind === "explicit" ? t("Saved memory") : t("Past chats")}
        </span>
        {memory.doNotMention ? <span>{t("Off")}</span> : null}
      </div>
      <div className="inspir-memory-actions">
        {editing ? (
          <>
            <button type="button" disabled={saving} onClick={save} aria-label={t("Save")}>
              <CheckCircle2 size={16} />
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setDraft(editableMemoryText(memory));
                setDraftCategory(memory.category || "general");
              }}
              aria-label={t("Cancel")}
            >
              <XCircle size={16} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(editableMemoryText(memory));
                setDraftCategory(memory.category || "general");
                setEditing(true);
              }}
              aria-label={t("Saved memory")}
            >
              <PencilLine size={16} />
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onUpdate(memory.id, { doNotMention: !memory.doNotMention })}
              aria-label={memory.doNotMention ? t("On") : t("Off")}
            >
              {memory.doNotMention ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <button type="button" disabled={saving} onClick={() => onDelete(memory.id)} aria-label={t("Clear all")}>
              <XCircle size={16} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

import { useMemo, useState } from "react";
import { BrainCircuit, Plus } from "lucide-react";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import { MemoryItemEditor } from "@/components/chat/MemoryItemEditor";
import { MemoryMiniToggle } from "@/components/chat/MemoryMiniToggle";
import { MemorySummaryCard } from "@/components/chat/MemorySummaryCard";
import {
  groupMemoriesByCategory,
  memoryCategoryOptions,
  translatedMemoryCategoryLabel,
  type MemoryCreateInput,
  type MemoryDashboard,
  type MemorySettingsPatch,
  type MemorySummarySection,
  type MemoryUpdateInput,
} from "@/components/chat/memory-model";

export function MemoryPanel({
  dashboard,
  loading,
  saving,
  error,
  onSettings,
  onCreate,
  onUpdate,
  onDelete,
  onClear,
  onLoadMore,
  t,
}: {
  dashboard: MemoryDashboard | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onSettings: (input: MemorySettingsPatch) => void;
  onCreate: (input: MemoryCreateInput) => void;
  onUpdate: (memoryId: string, input: MemoryUpdateInput) => void;
  onDelete: (memoryId: string) => void;
  onClear: () => void;
  onLoadMore: () => void;
  t: UiTranslator;
}) {
  const settings = dashboard?.settings;
  const enabled = settings?.enabled ?? true;
  const savedMemoryEnabled = settings?.savedMemoryEnabled ?? true;
  const chatHistoryEnabled = settings?.chatHistoryEnabled ?? true;
  const dreamingEnabled = settings?.dreamingEnabled ?? true;
  const grouped = useMemo(() => groupMemoriesByCategory(dashboard?.memories ?? []), [dashboard?.memories]);
  const memoryControlsDisabled = saving || !enabled || !savedMemoryEnabled;
  const [adding, setAdding] = useState(false);
  const [newMemory, setNewMemory] = useState("");
  const [newCategory, setNewCategory] = useState("preferences");
  const [correction, setCorrection] = useState("");

  function addMemory() {
    const content = newMemory.trim();
    if (!content) return;
    onCreate({ content, category: newCategory });
    setNewMemory("");
    setNewCategory("preferences");
    setAdding(false);
  }

  function saveCorrection() {
    const content = correction.trim();
    if (!content) return;
    onSettings({ correction: content });
    setCorrection("");
  }

  async function muteSummarySection(section: MemorySummarySection) {
    await fetch("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summarySectionId: section.id,
        action: "dont_mention",
      }),
    }).catch(() => undefined);
    onSettings({ refreshSummary: true });
  }

  return (
    <section className="inspir-memory-card">
      <div className="inspir-memory-head">
        <div className="inspir-profile-line-icon">
          <BrainCircuit size={22} />
        </div>
        <div>
          <strong>{t("Memory")}</strong>
          <span>{enabled ? t("On for this account") : t("Off for this account")}</span>
        </div>
      </div>

      <div className="inspir-memory-status-row inspir-memory-master-row">
        <div>
          <strong>{enabled ? t("Memory is on") : t("Memory is off")}</strong>
          <span>{enabled ? t("Used only when it helps.") : t("Nothing is saved or used.")}</span>
        </div>
        <button
          type="button"
          className={`inspir-memory-toggle ${enabled ? "is-on" : ""}`}
          aria-label={enabled ? t("Off") : t("On")}
          aria-pressed={enabled}
          disabled={saving || loading}
          onClick={() => onSettings({ enabled: !enabled })}
        >
          <span className="inspir-memory-toggle-track">
            <span className="inspir-memory-toggle-thumb" />
          </span>
          <strong>{enabled ? t("On") : t("Off")}</strong>
        </button>
      </div>

      {enabled ? (
        <div className="inspir-memory-setting-list">
          <MemoryMiniToggle
            label={t("Saved memory")}
            checked={savedMemoryEnabled}
            disabled={saving || loading}
            onChange={(checked) => onSettings({ savedMemoryEnabled: checked })}
          />
          <MemoryMiniToggle
            label={t("Past chats")}
            checked={chatHistoryEnabled}
            disabled={saving || loading || !savedMemoryEnabled}
            onChange={(checked) => onSettings({ chatHistoryEnabled: checked })}
          />
          <MemoryMiniToggle
            label={t("Synthesis")}
            checked={dreamingEnabled}
            disabled={saving || loading || !savedMemoryEnabled}
            onChange={(checked) => onSettings({ dreamingEnabled: checked })}
          />
        </div>
      ) : null}

      {loading ? <p className="inspir-memory-muted">{t("Loading memory...")}</p> : null}
      {error ? <p className="inspir-memory-error">{error}</p> : null}

      {settings && !settings.noticeSeenAt ? (
        <div className="inspir-memory-notice">
          <strong>{t("Memory is on for signed-in accounts.")}</strong>
          <p>
            {t(
              "Everything Inspir remembers is shown below as editable memory cards. You can add, edit, delete, or clear them anytime.",
            )}
          </p>
          <button type="button" disabled={saving} onClick={() => onSettings({ noticeSeen: true })}>
            {t("Got it")}
          </button>
        </div>
      ) : null}

      {dashboard ? (
        <>
          <MemorySummaryCard
            summary={dashboard.summary}
            saving={memoryControlsDisabled}
            correction={correction}
            onCorrection={setCorrection}
            onSaveCorrection={saveCorrection}
            onRefresh={() => onSettings({ refreshSummary: true })}
            onMuteSection={(section) => void muteSummarySection(section)}
            t={t}
          />

          <div className="inspir-memory-summary">
            <span>
              {dashboard.memories.length}{dashboard.memoryPage?.hasMore ? "+" : ""}{" "}
              {dashboard.memories.length === 1 ? t("saved memory") : t("saved memories")}
            </span>
            <div className="inspir-memory-summary-actions">
              <button type="button" disabled={memoryControlsDisabled} onClick={() => setAdding((current) => !current)}>
                <Plus size={15} />
                <span>{t("Add")}</span>
              </button>
              <button type="button" disabled={saving || dashboard.memories.length === 0} onClick={onClear}>
                {t("Clear all")}
              </button>
            </div>
          </div>

          {adding ? (
            <div className="inspir-memory-add">
              <textarea
                aria-label={t("Add")}
                value={newMemory}
                onChange={(event) => setNewMemory(event.target.value)}
                placeholder={t("Correct or add what Inspir should remember.")}
                rows={3}
                maxLength={600}
                disabled={memoryControlsDisabled}
              />
              <div className="inspir-memory-add-actions">
                <select
                  aria-label={t("Memory category")}
                  value={newCategory}
                  disabled={memoryControlsDisabled}
                  onChange={(event) => setNewCategory(event.target.value)}
                >
                  {memoryCategoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={memoryControlsDisabled || !newMemory.trim()} onClick={addMemory}>
                  {t("Save")}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setAdding(false);
                    setNewMemory("");
                    setNewCategory("preferences");
                  }}
                >
                  {t("Cancel")}
                </button>
              </div>
            </div>
          ) : null}

          <div className="inspir-memory-list">
            {dashboard.memories.length === 0 ? (
              <p className="inspir-memory-muted">{t("No saved memories yet.")}</p>
            ) : (
              grouped.map((group) => (
                <div key={group.category} className="inspir-memory-group">
                  <h4>{translatedMemoryCategoryLabel(group.category, t)}</h4>
                  {group.memories.map((memory) => (
                    <MemoryItemEditor
                      key={memory.id}
                      memory={memory}
                      saving={saving}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      t={t}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
          {dashboard.memoryPage?.hasMore ? (
            <button
              type="button"
              className="inspir-memory-load-more"
              disabled={loading || saving}
              onClick={onLoadMore}
            >
              {t("Continue")}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

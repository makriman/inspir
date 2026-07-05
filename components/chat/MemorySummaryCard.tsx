import { RefreshCw, XCircle } from "lucide-react";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import {
  translatedMemoryCategoryLabel,
  type MemorySummary,
  type MemorySummarySection,
} from "@/components/chat/memory-model";
import { formatAppDate } from "@/lib/utils/dates";

export function MemorySummaryCard({
  summary,
  saving,
  correction,
  onCorrection,
  onSaveCorrection,
  onRefresh,
  onMuteSection,
  t,
}: {
  summary: MemorySummary | null;
  saving: boolean;
  correction: string;
  onCorrection: (value: string) => void;
  onSaveCorrection: () => void;
  onRefresh: () => void;
  onMuteSection: (section: MemorySummarySection) => void;
  t: UiTranslator;
}) {
  const sections = summary?.sections?.filter((section) => !section.doNotMention) ?? [];
  return (
    <div className="inspir-memory-summary-card">
      <div className="inspir-memory-summary-card-head">
        <div>
          <strong>{t("Memory summary")}</strong>
          <span>{summary?.lastSynthesizedAt ? formatAppDate(summary.lastSynthesizedAt) : t("No summary yet")}</span>
        </div>
        <button type="button" disabled={saving} onClick={onRefresh} aria-label={t("Memory summary")}>
          <RefreshCw size={15} />
        </button>
      </div>

      {sections.length ? (
        <div className="inspir-memory-summary-sections">
          {sections.map((section) => (
            <article key={section.id} className="inspir-memory-summary-section">
              <div>
                <strong>{section.title || translatedMemoryCategoryLabel(section.category, t)}</strong>
                <p>{section.summary}</p>
              </div>
              <button type="button" disabled={saving} onClick={() => onMuteSection(section)} aria-label={t("Off")}>
                <XCircle size={15} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="inspir-memory-muted">{t("No summary yet")}</p>
      )}

      <div className="inspir-memory-correction">
        <textarea
          aria-label={t("Correct or add what Inspir should remember.")}
          value={correction}
          onChange={(event) => onCorrection(event.target.value)}
          placeholder={t("Correct or add what Inspir should remember.")}
          rows={2}
          maxLength={800}
          disabled={saving}
        />
        <button type="button" disabled={saving || !correction.trim()} onClick={onSaveCorrection}>
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

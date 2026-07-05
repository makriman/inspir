"use client";

import { useEffect, useRef } from "react";
import { Check, EyeOff, X, XCircle } from "lucide-react";
import type { MessageMemorySource } from "@/components/chat/chat-message-model";

export function MemorySourcesModal({
  sources,
  onClose,
  onFeedback,
}: {
  sources: MessageMemorySource[];
  onClose: () => void;
  onFeedback: (source: MessageMemorySource, action: "relevant" | "not_relevant" | "dont_mention") => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="inspir-modal-backdrop"
      aria-label="Memory sources"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <section className="inspir-memory-source-modal">
        <header>
          <div>
            <strong>Memory sources</strong>
            <span>{sources.length} used for this reply</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close memory sources">
            <X size={20} />
          </button>
        </header>
        <div className="inspir-memory-source-list app-scrollbar">
          {sources.map((source) => (
            <article key={source.id} className="inspir-memory-source-card">
              <div>
                <strong>{source.label}</strong>
                {source.reason ? <span>{source.reason}</span> : null}
              </div>
              <p>{source.excerpt}</p>
              <div className="inspir-memory-source-actions">
                <button type="button" onClick={() => onFeedback(source, "relevant")} aria-label="Mark source relevant">
                  <Check size={15} />
                </button>
                <button type="button" onClick={() => onFeedback(source, "not_relevant")} aria-label="Mark source not relevant">
                  <XCircle size={15} />
                </button>
                <button type="button" onClick={() => onFeedback(source, "dont_mention")} aria-label="Do not mention this source">
                  <EyeOff size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </dialog>
  );
}

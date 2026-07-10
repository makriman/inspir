"use client";

import type { CompletionNavigation } from "./result-client";

export function ResultSaveRecovery({ navigation }: Readonly<{ navigation: CompletionNavigation }>) {
  if (navigation.status !== "failed") return null;

  return (
    <section className="game-instructions-card result-save-recovery" data-testid="result-save-recovery">
      <p className="game-card-label">Result not saved</p>
      <h2>Your completed board is still here.</h2>
      <p>
        Cloud storage and this browser’s local storage were both unavailable. Retry the save or
        export the completed game before leaving this page.
      </p>
      <div className="result-save-recovery__actions">
        <button className="game-reset-button" type="button" onClick={navigation.retry}>
          Retry save
        </button>
        <button className="game-reset-button" type="button" onClick={navigation.exportResult}>
          Export completed game
        </button>
      </div>
    </section>
  );
}

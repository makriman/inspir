import { Clipboard } from "lucide-react";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import {
  type MainAppActivitySourceKey,
  translateMainAppActivity,
} from "@/lib/i18n/main-app-activity-copy";

const flashcardBuildStepKeys = [
  "activity.flashcards.loader.atomic",
  "activity.flashcards.loader.prompts",
  "activity.flashcards.loader.hints",
  "activity.flashcards.loader.traps",
  "activity.flashcards.loader.stack",
  "activity.flashcards.loader.ready",
] as const satisfies readonly MainAppActivitySourceKey[];

export function FlashcardBuildLoader({
  topic,
  progress,
  t,
}: {
  topic: string;
  progress: number;
  t: UiTranslator;
}) {
  const stepIndex = Math.min(
    flashcardBuildStepKeys.length - 1,
    Math.floor((progress / 100) * flashcardBuildStepKeys.length),
  );
  return (
    <section className="inspir-quiz-loader inspir-flashcard-loader" aria-live="polite">
      <div className="inspir-flashcard-loader-stack">
        <span />
        <span />
        <span />
        <Clipboard size={26} />
      </div>
      <div>
        <span className="inspir-quiz-loader-kicker">
          {translateMainAppActivity(t, "activity.flashcards.loader.title")}
        </span>
        <h2>
          {topic.trim() ||
            translateMainAppActivity(t, "activity.flashcards.loader.topicFallback")}
        </h2>
        <p>{translateMainAppActivity(t, flashcardBuildStepKeys[stepIndex])}</p>
      </div>
      <div className="inspir-quiz-loader-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className="inspir-quiz-loader-steps">
        {flashcardBuildStepKeys.map((stepKey, index) => (
          <li key={stepKey} className={index <= stepIndex ? "is-active" : ""}>
            {translateMainAppActivity(t, stepKey)}
          </li>
        ))}
      </ol>
    </section>
  );
}

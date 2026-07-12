import { Sparkles } from "lucide-react";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import {
  type MainAppActivitySourceKey,
  translateMainAppActivity,
} from "@/lib/i18n/main-app-activity-copy";

const quizBuildStepKeys = [
  "activity.quiz.loader.scan",
  "activity.quiz.loader.balance",
  "activity.quiz.loader.options",
  "activity.quiz.loader.answers",
  "activity.quiz.loader.explanations",
  "activity.quiz.loader.shuffle",
] as const satisfies readonly MainAppActivitySourceKey[];

export function QuizBuildLoader({
  topic,
  progress,
  t,
}: {
  topic: string;
  progress: number;
  t: UiTranslator;
}) {
  const stepIndex = Math.min(
    quizBuildStepKeys.length - 1,
    Math.floor((progress / 100) * quizBuildStepKeys.length),
  );
  return (
    <section className="inspir-quiz-loader" aria-live="polite">
      <div className="inspir-quiz-loader-orbit">
        <Sparkles size={28} />
        <span />
        <span />
        <span />
      </div>
      <div>
        <span className="inspir-quiz-loader-kicker">
          {translateMainAppActivity(t, "activity.quiz.loader.title")}
        </span>
        <h2>{topic.trim() || translateMainAppActivity(t, "activity.quiz.loader.topicFallback")}</h2>
        <p>{translateMainAppActivity(t, quizBuildStepKeys[stepIndex])}</p>
      </div>
      <div className="inspir-quiz-loader-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className="inspir-quiz-loader-steps">
        {quizBuildStepKeys.map((stepKey, index) => (
          <li key={stepKey} className={index <= stepIndex ? "is-active" : ""}>
            {translateMainAppActivity(t, stepKey)}
          </li>
        ))}
      </ol>
    </section>
  );
}

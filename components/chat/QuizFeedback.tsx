import { CheckCircle2, XCircle } from "lucide-react";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import { translateMainAppActivity } from "@/lib/i18n/main-app-activity-copy";

type QuizFeedbackQuestion = {
  explanation?: string;
  isCorrect?: boolean;
};

export function QuizFeedback({
  question,
  t,
}: {
  question: QuizFeedbackQuestion;
  t: UiTranslator;
}) {
  const correct = question.isCorrect;
  return (
    <aside className={`inspir-quiz-feedback ${correct ? "is-correct" : "is-wrong"}`}>
      {correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
      <div>
        <strong>
          {translateMainAppActivity(
            t,
            correct ? "activity.quiz.feedback.correct" : "activity.quiz.feedback.incorrect",
          )}
        </strong>
        <span>{question.explanation}</span>
      </div>
    </aside>
  );
}

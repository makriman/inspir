import type { UiTranslator } from "@/components/chat/chat-ui-types";
import {
  formatMainAppActivity,
  translateMainAppActivity,
} from "@/lib/i18n/main-app-activity-copy";

type QuizReviewQuestion = {
  id: string;
  prompt: string;
  options: string[];
  userAnswerIndex?: number;
  correctIndex?: number;
  explanation?: string;
  isCorrect?: boolean;
};

type QuizReviewState = {
  score: number;
  questions: QuizReviewQuestion[];
};

export function QuizReview({ quiz, t }: { quiz: QuizReviewState; t: UiTranslator }) {
  return (
    <article className="inspir-quiz-review">
      <h3>
        {formatMainAppActivity(t, "activity.quiz.review.score", {
          score: quiz.score,
          total: quiz.questions.length,
        })}
      </h3>
      <p>
        {quiz.score >= 8
          ? translateMainAppActivity(t, "activity.quiz.review.strong")
          : quiz.score >= 5
            ? translateMainAppActivity(t, "activity.quiz.review.base")
            : translateMainAppActivity(t, "activity.quiz.review.rebuild")}
      </p>
      <div className="inspir-review-list">
        {quiz.questions.map((question, index) => (
          <div key={question.id} className={question.isCorrect ? "is-correct" : "is-wrong"}>
            <strong>
              {index + 1}. {question.prompt}
            </strong>
            <span>
              {formatMainAppActivity(t, "activity.quiz.review.userAnswer", {
                answer: answerLabel(question, question.userAnswerIndex, t),
              })}
            </span>
            <span>
              {formatMainAppActivity(t, "activity.quiz.review.correctAnswer", {
                answer: answerLabel(question, question.correctIndex, t),
              })}
            </span>
            <p>{question.explanation}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function answerLabel(
  question: QuizReviewQuestion,
  index: number | undefined,
  t: UiTranslator,
) {
  if (index === undefined) {
    return translateMainAppActivity(t, "activity.quiz.review.notAnswered");
  }
  return `${String.fromCharCode(65 + index)}. ${question.options[index] ?? ""}`;
}

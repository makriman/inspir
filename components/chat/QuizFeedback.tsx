import { CheckCircle2, XCircle } from "lucide-react";

type QuizFeedbackQuestion = {
  explanation?: string;
  isCorrect?: boolean;
};

export function QuizFeedback({ question }: { question: QuizFeedbackQuestion }) {
  const correct = question.isCorrect;
  return (
    <aside className={`inspir-quiz-feedback ${correct ? "is-correct" : "is-wrong"}`}>
      {correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
      <div>
        <strong>{correct ? "Correct" : "Not quite"}</strong>
        <span>{question.explanation}</span>
      </div>
    </aside>
  );
}

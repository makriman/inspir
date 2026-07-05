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

export function QuizReview({ quiz }: { quiz: QuizReviewState }) {
  return (
    <article className="inspir-quiz-review">
      <h3>Final score: {quiz.score}/10</h3>
      <p>
        {quiz.score >= 8
          ? "Strong work."
          : quiz.score >= 5
            ? "Good base. Review the misses below."
            : "You have a starting map now. Let us rebuild the weak spots."}
      </p>
      <div className="inspir-review-list">
        {quiz.questions.map((question, index) => (
          <div key={question.id} className={question.isCorrect ? "is-correct" : "is-wrong"}>
            <strong>
              {index + 1}. {question.prompt}
            </strong>
            <span>Your answer: {answerLabel(question, question.userAnswerIndex)}</span>
            <span>Correct: {answerLabel(question, question.correctIndex)}</span>
            <p>{question.explanation}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function answerLabel(question: QuizReviewQuestion, index: number | undefined) {
  if (index === undefined) return "Not answered";
  return `${String.fromCharCode(65 + index)}. ${question.options[index] ?? ""}`;
}

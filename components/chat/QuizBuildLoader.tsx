import { Sparkles } from "lucide-react";

const quizBuildSteps = [
  "Scanning the topic",
  "Balancing difficulty",
  "Writing clear options",
  "Hiding the answers",
  "Preparing explanations",
  "Shuffling the challenge",
];

export function QuizBuildLoader({ topic, progress }: { topic: string; progress: number }) {
  const stepIndex = Math.min(quizBuildSteps.length - 1, Math.floor((progress / 100) * quizBuildSteps.length));
  return (
    <section className="inspir-quiz-loader" aria-live="polite">
      <div className="inspir-quiz-loader-orbit">
        <Sparkles size={28} />
        <span />
        <span />
        <span />
      </div>
      <div>
        <span className="inspir-quiz-loader-kicker">Building your quiz</span>
        <h2>{topic.trim() || "Your topic"}</h2>
        <p>{quizBuildSteps[stepIndex]}</p>
      </div>
      <div className="inspir-quiz-loader-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className="inspir-quiz-loader-steps">
        {quizBuildSteps.map((step, index) => (
          <li key={step} className={index <= stepIndex ? "is-active" : ""}>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

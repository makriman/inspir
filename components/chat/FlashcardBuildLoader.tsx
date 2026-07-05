import { Clipboard } from "lucide-react";

const flashcardBuildSteps = [
  "Finding atomic ideas",
  "Writing recall prompts",
  "Adding memory hints",
  "Checking common traps",
  "Stacking the deck",
  "Ready for review",
];

export function FlashcardBuildLoader({ topic, progress }: { topic: string; progress: number }) {
  const stepIndex = Math.min(
    flashcardBuildSteps.length - 1,
    Math.floor((progress / 100) * flashcardBuildSteps.length),
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
        <span className="inspir-quiz-loader-kicker">Building your deck</span>
        <h2>{topic.trim() || "Your topic"}</h2>
        <p>{flashcardBuildSteps[stepIndex]}</p>
      </div>
      <div className="inspir-quiz-loader-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className="inspir-quiz-loader-steps">
        {flashcardBuildSteps.map((step, index) => (
          <li key={step} className={index <= stepIndex ? "is-active" : ""}>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

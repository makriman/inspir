"use client";

import { FormEvent, useEffect, useReducer } from "react";
import { Sparkles } from "lucide-react";
import {
  type ActivityRun,
  type ActivityRunResponse,
  isQuizState,
  mergeActivityState,
} from "@/components/chat/activity-model";
import { QuizBuildLoader } from "@/components/chat/QuizBuildLoader";
import { QuizFeedback } from "@/components/chat/QuizFeedback";
import { QuizReview } from "@/components/chat/QuizReview";

type QuizWorkspaceProps = {
  activeChatId?: string;
  activeTopicId: string;
  activityRun: ActivityRun | null;
  createChat: (topicId?: string) => Promise<string>;
  onActivityRun: (run: ActivityRun | null) => void;
};

export function QuizWorkspace({
  activeChatId,
  activeTopicId,
  activityRun,
  createChat,
  onActivityRun,
}: QuizWorkspaceProps) {
  const [{ topic, loading, buildProgress, answering, error }, updateQuizState] = useReducer(
    mergeActivityState<{
      topic: string;
      loading: boolean;
      buildProgress: number;
      answering: boolean;
      error: string;
    }>,
    { topic: "", loading: false, buildProgress: 0, answering: false, error: "" },
  );
  const quiz = activityRun?.type === "quiz" && isQuizState(activityRun.state) ? activityRun.state : null;
  const currentQuestion = quiz?.questions[quiz.currentIndex];
  const lastAnswered = quiz
    ? [...quiz.questions].reverse().find((question) => question.userAnswerIndex !== undefined)
    : undefined;

  useEffect(() => {
    if (!loading) return;
    const interval = window.setInterval(() => {
      updateQuizState((current) => ({
        buildProgress: Math.min(94, current.buildProgress + Math.max(3, Math.round((100 - current.buildProgress) / 7))),
      }));
    }, 520);

    return () => window.clearInterval(interval);
  }, [loading]);

  async function startQuiz(event?: FormEvent) {
    event?.preventDefault();
    const quizTopic = topic.trim();
    if (!quizTopic || loading) return;
    updateQuizState({ error: "", buildProgress: 8, loading: true });
    try {
      const chatId = activeChatId ?? (await createChat(activeTopicId));
      const response = await fetch("/api/activities/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, topic: quizTopic }),
      });
      if (!response.ok) throw new Error("Could not build quiz");
      const data = (await response.json()) as ActivityRunResponse;
      updateQuizState({ buildProgress: 100 });
      onActivityRun(data.activityRun);
    } catch {
      updateQuizState({
        error: "I could not build that quiz right now. Try a simpler topic or try again.",
        buildProgress: 0,
      });
    } finally {
      updateQuizState({ loading: false });
    }
  }

  async function answerQuestion(answerIndex: number) {
    if (!activityRun || answering) return;
    updateQuizState({ answering: true, error: "" });
    try {
      const response = await fetch(`/api/activities/quiz/${activityRun.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answerIndex }),
      });
      if (!response.ok) throw new Error("Could not score answer");
      const data = (await response.json()) as ActivityRunResponse;
      onActivityRun(data.activityRun);
    } catch {
      updateQuizState({ error: "I could not score that answer. Please try again." });
    } finally {
      updateQuizState({ answering: false });
    }
  }

  return (
    <main className="inspir-workspace inspir-quiz-workspace">
      {!quiz ? (
        loading ? (
          <QuizBuildLoader topic={topic} progress={buildProgress} />
        ) : (
          <form onSubmit={startQuiz} className="inspir-quiz-start">
            <div className="inspir-quiz-start-icon">
              <Sparkles size={28} />
            </div>
            <h2>What would you like to be quizzed on today?</h2>
            <p>Pick any topic. I will build 10 multiple-choice questions and score you as you go.</p>
            <div className="inspir-quiz-input-row">
              <input
                aria-label="Quiz topic"
                value={topic}
                onChange={(event) => updateQuizState({ topic: event.target.value })}
                placeholder="Space exploration, Indian history, algebra..."
                disabled={loading}
              />
              <button type="submit" disabled={loading || !topic.trim()}>
                Start
              </button>
            </div>
            {error ? <span className="inspir-quiz-error">{error}</span> : null}
          </form>
        )
      ) : (
        <section className="inspir-quiz-card">
          <header className="inspir-quiz-header">
            <div>
              <span>Quiz on</span>
              <h2>{quiz.topic}</h2>
            </div>
            <strong>
              {quiz.score}/{quiz.maxScore}
            </strong>
          </header>
          <div className="inspir-quiz-progress">
            <span style={{ width: `${(quiz.questions.filter((q) => q.userAnswerIndex !== undefined).length / 10) * 100}%` }} />
          </div>

          {lastAnswered ? <QuizFeedback question={lastAnswered} /> : null}

          {!quiz.completed && currentQuestion ? (
            <article className="inspir-question-card">
              <span>
                Question {quiz.currentIndex + 1} of {quiz.maxScore}
              </span>
              <h3>{currentQuestion.prompt}</h3>
              <div className="inspir-option-grid">
                {currentQuestion.options.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    disabled={answering}
                    onClick={() => void answerQuestion(index)}
                  >
                    <strong>{String.fromCharCode(65 + index)}</strong>
                    <span>{option}</span>
                  </button>
                ))}
              </div>
            </article>
          ) : (
            <QuizReview quiz={quiz} />
          )}
          {error ? <span className="inspir-quiz-error">{error}</span> : null}
        </section>
      )}
    </main>
  );
}

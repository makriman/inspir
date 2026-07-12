"use client";

import { FormEvent, useEffect, useReducer, useRef } from "react";
import { Sparkles } from "lucide-react";
import {
  type ActivityRun,
  type ActivityRunResponse,
  isQuizState,
  mergeActivityState,
} from "@/components/chat/activity-model";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import { QuizBuildLoader } from "@/components/chat/QuizBuildLoader";
import { QuizFeedback } from "@/components/chat/QuizFeedback";
import { QuizReview } from "@/components/chat/QuizReview";
import {
  formatMainAppActivity,
  translateMainAppActivity,
} from "@/lib/i18n/main-app-activity-copy";

type QuizWorkspaceProps = {
  activeChatId?: string;
  activeTopicId: string;
  activityRun: ActivityRun | null;
  createChat: (topicId?: string) => Promise<string>;
  onActivityRun: (run: ActivityRun | null) => void;
  t: UiTranslator;
};

export function QuizWorkspace({
  activeChatId,
  activeTopicId,
  activityRun,
  createChat,
  onActivityRun,
  t,
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
  const pendingBuildRequest = useRef<{ signature: string; requestId: string } | null>(null);
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
      const signature = `${chatId}\n${quizTopic}`;
      const buildRequest = pendingBuildRequest.current?.signature === signature
        ? pendingBuildRequest.current
        : { signature, requestId: crypto.randomUUID() };
      pendingBuildRequest.current = buildRequest;
      const response = await fetch("/api/activities/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chatId,
          topic: quizTopic,
          requestId: buildRequest.requestId,
        }),
      });
      if (!response.ok) throw new Error("Could not build quiz");
      const data = (await response.json()) as ActivityRunResponse;
      pendingBuildRequest.current = null;
      updateQuizState({ buildProgress: 100 });
      onActivityRun(data.activityRun);
    } catch {
      updateQuizState({
        error: translateMainAppActivity(t, "activity.quiz.error.build"),
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
      updateQuizState({ error: translateMainAppActivity(t, "activity.quiz.error.score") });
    } finally {
      updateQuizState({ answering: false });
    }
  }

  return (
    <main className="inspir-workspace inspir-quiz-workspace" data-no-auto-translate>
      {!quiz ? (
        loading ? (
          <QuizBuildLoader topic={topic} progress={buildProgress} t={t} />
        ) : (
          <form onSubmit={startQuiz} className="inspir-quiz-start">
            <div className="inspir-quiz-start-icon">
              <Sparkles size={28} />
            </div>
            <h2>{translateMainAppActivity(t, "activity.quiz.start.title")}</h2>
            <p>{translateMainAppActivity(t, "activity.quiz.start.body")}</p>
            <div className="inspir-quiz-input-row">
              <input
                aria-label={translateMainAppActivity(t, "activity.quiz.start.topicLabel")}
                value={topic}
                onChange={(event) => updateQuizState({ topic: event.target.value })}
                placeholder={translateMainAppActivity(t, "activity.quiz.start.topicPlaceholder")}
                disabled={loading}
              />
              <button type="submit" disabled={loading || !topic.trim()}>
                {translateMainAppActivity(t, "activity.quiz.start.action")}
              </button>
            </div>
            {error ? <span className="inspir-quiz-error">{error}</span> : null}
          </form>
        )
      ) : (
        <section className="inspir-quiz-card">
          <header className="inspir-quiz-header">
            <div>
              <span>{translateMainAppActivity(t, "activity.quiz.header")}</span>
              <h2>{quiz.topic}</h2>
            </div>
            <strong>
              {quiz.score}/{quiz.maxScore}
            </strong>
          </header>
          <div className="inspir-quiz-progress">
            <span style={{ width: `${(quiz.questions.filter((q) => q.userAnswerIndex !== undefined).length / 10) * 100}%` }} />
          </div>

          {lastAnswered ? <QuizFeedback question={lastAnswered} t={t} /> : null}

          {!quiz.completed && currentQuestion ? (
            <article className="inspir-question-card">
              <span>
                {formatMainAppActivity(t, "activity.quiz.progress", {
                  current: quiz.currentIndex + 1,
                  total: quiz.maxScore,
                })}
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
            <QuizReview quiz={quiz} t={t} />
          )}
          {error ? <span className="inspir-quiz-error">{error}</span> : null}
        </section>
      )}
    </main>
  );
}

"use client";

import {
  FormEvent,
  KeyboardEvent,
  RefObject,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  BookOpenCheck,
  CheckCircle2,
  CircleHelp,
  Compass,
  Gauge,
  GitBranch,
  Lightbulb,
  ListChecks,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Target,
  Zap,
} from "lucide-react";
import { TopicResourceLinks } from "@/components/chat/TopicResourceLinks";
import { formatBubbleDate } from "@/lib/utils/dates";

type Topic = {
  id: string;
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
  metadata?: Record<string, unknown> | null;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string | Date;
  metadata?: Record<string, unknown>;
};

type SocraticMode = "pure" | "guided" | "exam" | "decision" | "debate";
type TargetKind = "concept" | "problem" | "text" | "argument" | "decision" | "exam";

type MapNode = {
  id: string;
  label: string;
  detail: string;
  tone: "claim" | "assumption" | "gap" | "correction" | "question";
};

type ThinkingMap = {
  claims: MapNode[];
  assumptions: MapNode[];
  gaps: MapNode[];
  corrections: MapNode[];
  questions: MapNode[];
};

const sessionStartMarker = "[Socratic session start]";
const coachControlMarker = "[Coach control]";

const targetKinds: Array<{ id: TargetKind; label: string; example: string }> = [
  { id: "concept", label: "Concept", example: "opportunity cost" },
  { id: "problem", label: "Problem", example: "Should a company enter this market?" },
  { id: "text", label: "Text", example: "Paste an article, case, or passage" },
  { id: "argument", label: "Argument", example: "Remote work is better" },
  { id: "decision", label: "Decision", example: "Should I take this job?" },
  { id: "exam", label: "Exam", example: "contract law consideration" },
];

const socraticModes: Array<{ id: SocraticMode; label: string; description: string }> = [
  { id: "guided", label: "Guided", description: "Questions with brief coaching." },
  { id: "pure", label: "Pure", description: "Strict questioning, minimal explanation." },
  { id: "exam", label: "Exam", description: "Rubric-aware prompts." },
  { id: "decision", label: "Decision", description: "Tradeoffs and assumptions." },
  { id: "debate", label: "Debate", description: "Pressure-test a position." },
];

const contractItems = [
  "One question at a time.",
  "No full answer unless you ask.",
  "Your answer controls the next question.",
  "Hints climb gradually.",
  "You produce the final synthesis.",
];

const hintSteps = [
  { label: "Nudge", body: "Point attention to the relevant part." },
  { label: "Contrast", body: "Compare two nearby cases." },
  { label: "Example", body: "Show a similar solved case." },
  { label: "Partial link", body: "Fill one missing connection." },
  { label: "Explanation", body: "Use only as the last resort." },
];

const mapSections: Array<{
  key: keyof ThinkingMap;
  title: string;
  empty: string;
}> = [
  { key: "claims", title: "User claims", empty: "Waiting for your first answer." },
  { key: "assumptions", title: "Assumptions", empty: "Assumptions will appear as they surface." },
  { key: "gaps", title: "Gaps and contradictions", empty: "No clear gap marked yet." },
  { key: "corrections", title: "Corrected ideas", empty: "Corrections arrive after testing." },
  { key: "questions", title: "Question path", empty: "The question path starts now." },
];

export function SocraticWorkspace({
  topic,
  userName,
  messages,
  input,
  sending,
  awaitingResponse,
  inputRef,
  listRef,
  onInput,
  onSend,
  onSubmit,
  onKeyDown,
  onStop,
  onReset,
}: {
  topic: Topic;
  userName: string;
  messages: Message[];
  input: string;
  sending: boolean;
  awaitingResponse: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  onInput: (value: string) => void;
  onSend: (content: string) => Promise<void>;
  onSubmit: (event?: FormEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const starters = getTopicStarters(topic);
  const [targetKind, setTargetKind] = useState<TargetKind>("concept");
  const [mode, setMode] = useState<SocraticMode>("guided");
  const [target, setTarget] = useState("");
  const [hintLevel, setHintLevel] = useState(0);

  const visibleMessages = messages.filter((message) => message.role !== "system");
  const sessionStart = visibleMessages.find((message) => isSessionStart(message.content));
  const hasSession = Boolean(sessionStart || visibleMessages.length > 0 || sending || awaitingResponse);
  const session = parseSessionStart(sessionStart?.content) ?? {
    targetKind,
    mode,
    target: target.trim() || topic.name,
  };
  const displayMessages = visibleMessages.filter((message) => !isHiddenInstruction(message.content));
  const learnerMessages = displayMessages.filter((message) => message.role === "user");
  const latestAssistant = [...displayMessages].reverse().find((message) => message.role === "assistant");
  const activeQuestion = latestAssistant
    ? extractQuestion(latestAssistant.content)
    : "Set a thinking target and I will ask the first diagnostic question.";
  const latestFeedback = latestAssistant ? extractField(latestAssistant.content, ["Brief read", "Feedback"]) : "";

  const thinkingMap = useMemo(() => buildThinkingMap(displayMessages), [displayMessages]);
  const progress = useMemo(() => buildProgress(displayMessages, thinkingMap), [displayMessages, thinkingMap]);
  const misconception = useMemo(() => extractMisconception(latestAssistant?.content ?? ""), [latestAssistant]);

  function startSession(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = target.trim();
    if (!trimmed || sending) return;
    setHintLevel(0);
    void onSend(buildSocraticStartPrompt({ target: trimmed, targetKind, mode }));
  }

  function sendCoachControl(kind: "hint" | "rephrase" | "example" | "challenge" | "synthesis" | "reveal") {
    if (sending) return;
    const nextHintLevel = kind === "hint" ? Math.min(hintLevel + 1, 4) : hintLevel;
    if (kind === "hint") setHintLevel(nextHintLevel);
    void onSend(buildCoachPrompt(kind, nextHintLevel));
  }

  return (
    <main className="bubble-workspace socratic-workspace">
      <div ref={hasSession ? listRef : undefined} className="socratic-scroll app-scrollbar">
        {!hasSession ? (
          <SocraticStartScreen
            topic={topic}
            starters={starters}
            target={target}
            targetKind={targetKind}
            mode={mode}
            sending={sending}
            onStart={startSession}
            onMode={setMode}
            onTarget={setTarget}
            onTargetKind={setTargetKind}
          />
        ) : (
          <SocraticSessionView
            session={session}
            progress={progress}
            hintLevel={hintLevel}
            misconception={misconception}
            activeQuestion={activeQuestion}
            latestFeedback={latestFeedback}
            displayMessages={displayMessages}
            userName={userName}
            input={input}
            sending={sending}
            awaitingResponse={awaitingResponse}
            inputRef={inputRef}
            thinkingMap={thinkingMap}
            learnerAnswerCount={learnerMessages.length}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onReset={onReset}
            onSubmit={onSubmit}
            onStop={onStop}
            onCoachControl={sendCoachControl}
          />
        )}
      </div>
    </main>
  );
}

function SocraticStartScreen({
  topic,
  starters,
  target,
  targetKind,
  mode,
  sending,
  onStart,
  onMode,
  onTarget,
  onTargetKind,
}: {
  topic: Topic;
  starters: string[];
  target: string;
  targetKind: TargetKind;
  mode: SocraticMode;
  sending: boolean;
  onStart: (event?: FormEvent) => void;
  onMode: (mode: SocraticMode) => void;
  onTarget: (target: string) => void;
  onTargetKind: (kind: TargetKind) => void;
}) {
  const activeKind = targetKinds.find((kind) => kind.id === targetKind);
  return (
    <section className="socratic-start">
      <div className="socratic-start-copy">
        <div className="socratic-kicker">
          <Gauge size={18} />
          <span>Socratic Instruction</span>
        </div>
        <h2>Build understanding by answering one precise question at a time.</h2>
        <div className="socratic-contract" aria-label="Socratic contract">
          {contractItems.map((item) => (
            <span key={item}>
              <CheckCircle2 size={15} />
              {item}
            </span>
          ))}
        </div>
      </div>

      <form className="socratic-start-form" onSubmit={onStart}>
        <div className="socratic-form-head">
          <Target size={22} />
          <div>
            <strong>Thinking target</strong>
            <span>Start with a concept, case, argument, decision, or text.</span>
          </div>
        </div>

        <div className="socratic-segment-grid" aria-label="Target type">
          {targetKinds.map((kind) => (
            <button
              key={kind.id}
              type="button"
              className={kind.id === targetKind ? "is-active" : ""}
              onClick={() => {
                onTargetKind(kind.id);
                if (!target.trim()) onTarget(kind.example);
              }}
            >
              {kind.label}
            </button>
          ))}
        </div>

        <label className="socratic-target-input">
          <span>{activeKind?.label ?? "Target"}</span>
          <textarea
            value={target}
            onChange={(event) => onTarget(event.target.value)}
            placeholder={activeKind?.example}
            rows={4}
            disabled={sending}
          />
        </label>

        <div className="socratic-mode-row" aria-label="Socratic mode">
          {socraticModes.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.description}
              className={option.id === mode ? "is-active" : ""}
              onClick={() => onMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button type="submit" className="socratic-start-button" disabled={!target.trim() || sending}>
          <Sparkles size={17} />
          Begin with the first question
        </button>
      </form>

      {starters.length ? (
        <div className="socratic-starter-row">
          {starters.map((starter) => (
            <button key={starter} type="button" onClick={() => onTarget(starter)}>
              <Compass size={15} />
              <span>{starter}</span>
            </button>
          ))}
        </div>
      ) : null}
      <TopicResourceLinks topic={topic} />
    </section>
  );
}

function SocraticSessionView({
  session,
  progress,
  hintLevel,
  misconception,
  activeQuestion,
  latestFeedback,
  displayMessages,
  userName,
  input,
  sending,
  awaitingResponse,
  inputRef,
  thinkingMap,
  learnerAnswerCount,
  onInput,
  onKeyDown,
  onReset,
  onSubmit,
  onStop,
  onCoachControl,
}: {
  session: { targetKind: TargetKind; mode: SocraticMode; target: string };
  progress: Array<{ label: string; active: boolean }>;
  hintLevel: number;
  misconception: string;
  activeQuestion: string;
  latestFeedback: string;
  displayMessages: Message[];
  userName: string;
  input: string;
  sending: boolean;
  awaitingResponse: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  thinkingMap: ThinkingMap;
  learnerAnswerCount: number;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onReset: () => void;
  onSubmit: (event?: FormEvent) => void;
  onStop: () => void;
  onCoachControl: (kind: "hint" | "rephrase" | "example" | "challenge" | "synthesis" | "reveal") => void;
}) {
  return (
    <section className="socratic-chamber">
      <SocraticSessionRail session={session} progress={progress} hintLevel={hintLevel} onReset={onReset} />
      <section className="socratic-focus-column">
        <SocraticQuestionCard question={activeQuestion} feedback={latestFeedback} misconception={misconception} />
        <SocraticCoachControls hintLevel={hintLevel} sending={sending} onCoachControl={onCoachControl} />
        <SocraticAnswerBox
          input={input}
          sending={sending}
          inputRef={inputRef}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onSubmit={onSubmit}
          onStop={onStop}
        />
        <SocraticLog messages={displayMessages} awaitingResponse={awaitingResponse} userName={userName} />
      </section>
      <ThinkingMapPanel map={thinkingMap} learnerAnswerCount={learnerAnswerCount} />
    </section>
  );
}

function SocraticSessionRail({
  session,
  progress,
  hintLevel,
  onReset,
}: {
  session: { targetKind: TargetKind; mode: SocraticMode; target: string };
  progress: Array<{ label: string; active: boolean }>;
  hintLevel: number;
  onReset: () => void;
}) {
  return (
    <aside className="socratic-session-rail">
      <section className="socratic-target-panel">
        <span>{targetKinds.find((kind) => kind.id === session.targetKind)?.label ?? "Target"}</span>
        <strong>{session.target}</strong>
        <em>{socraticModes.find((option) => option.id === session.mode)?.label ?? "Guided"} mode</em>
      </section>
      <section className="socratic-depth-panel">
        <div className="socratic-panel-title">
          <ListChecks size={16} />
          <strong>Reasoning depth</strong>
        </div>
        <div className="socratic-depth-list">
          {progress.map((stage) => (
            <span key={stage.label} className={stage.active ? "is-active" : ""}>
              {stage.label}
            </span>
          ))}
        </div>
      </section>
      <section className="socratic-hint-panel">
        <div className="socratic-panel-title">
          <Lightbulb size={16} />
          <strong>Hint ladder</strong>
        </div>
        <div className="socratic-hint-list">
          {hintSteps.map((step, index) => (
            <article key={step.label} className={index < hintLevel ? "is-open" : ""}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <em>{step.body}</em>
              </div>
            </article>
          ))}
        </div>
      </section>
      <button type="button" onClick={onReset} className="socratic-new-session">
        <RefreshCw size={16} />
        New target
      </button>
    </aside>
  );
}

function SocraticQuestionCard({
  question,
  feedback,
  misconception,
}: {
  question: string;
  feedback: string;
  misconception: string;
}) {
  return (
    <article className="socratic-question-card">
      <div className="socratic-question-head">
        <div>
          <span>Question focus</span>
          <strong>Answer this question before moving on.</strong>
        </div>
        {misconception ? <em>{misconception}</em> : null}
      </div>
      <p>{question}</p>
      {feedback ? <small>{feedback}</small> : null}
    </article>
  );
}

function SocraticCoachControls({
  hintLevel,
  sending,
  onCoachControl,
}: {
  hintLevel: number;
  sending: boolean;
  onCoachControl: (kind: "hint" | "rephrase" | "example" | "challenge" | "synthesis" | "reveal") => void;
}) {
  return (
    <div className="socratic-coach-controls" aria-label="Coach controls">
      <CoachButton
        icon={Lightbulb}
        label={hintLevel ? `Hint ${Math.min(hintLevel + 1, 4)}` : "Hint"}
        title="Ask for the next hint level"
        onClick={() => onCoachControl("hint")}
        disabled={sending}
      />
      <CoachButton
        icon={CircleHelp}
        label="Rephrase"
        title="Ask for the same question in simpler words"
        onClick={() => onCoachControl("rephrase")}
        disabled={sending}
      />
      <CoachButton
        icon={BookOpenCheck}
        label="Example"
        title="Ask for a parallel example"
        onClick={() => onCoachControl("example")}
        disabled={sending}
      />
      <CoachButton
        icon={Zap}
        label="Challenge"
        title="Pressure-test the last answer"
        onClick={() => onCoachControl("challenge")}
        disabled={sending}
      />
      <CoachButton
        icon={ListChecks}
        label="Synthesize"
        title="Move toward final synthesis"
        onClick={() => onCoachControl("synthesis")}
        disabled={sending}
      />
      <CoachButton
        icon={Sparkles}
        label="Reveal"
        title="Ask for a direct explanation"
        onClick={() => onCoachControl("reveal")}
        disabled={sending}
      />
    </div>
  );
}

function SocraticAnswerBox({
  input,
  sending,
  inputRef,
  onInput,
  onKeyDown,
  onSubmit,
  onStop,
}: {
  input: string;
  sending: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event?: FormEvent) => void;
  onStop: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="socratic-answer-box">
      <textarea
        aria-label="Socratic answer"
        ref={inputRef}
        value={input}
        onChange={(event) => onInput(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write your answer, even if it is rough."
        disabled={sending}
        rows={3}
      />
      <button
        type={sending ? "button" : "submit"}
        onClick={sending ? onStop : undefined}
        disabled={!sending && !input.trim()}
        aria-label={sending ? "Stop response" : "Send answer"}
      >
        {sending ? <Square size={16} fill="currentColor" /> : <Send size={18} />}
        <span>{sending ? "Stop" : "Send"}</span>
      </button>
    </form>
  );
}

function SocraticLog({
  messages,
  awaitingResponse,
  userName,
}: {
  messages: Message[];
  awaitingResponse: boolean;
  userName: string;
}) {
  return (
    <section className="socratic-log">
      <div className="socratic-panel-title">
        <GitBranch size={16} />
        <strong>Reasoning log</strong>
      </div>
      <div className="socratic-log-stack">
        {messages.length ? (
          messages.map((message) => <SocraticTurn key={message.id} message={message} userName={userName} />)
        ) : awaitingResponse ? (
          <ThinkingPulse />
        ) : null}
        {awaitingResponse && messages.length ? <ThinkingPulse /> : null}
      </div>
    </section>
  );
}

function CoachButton({
  icon: Icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}>
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );
}

function ThinkingMapPanel({ map, learnerAnswerCount }: { map: ThinkingMap; learnerAnswerCount: number }) {
  return (
    <aside className="socratic-map-panel">
      <div className="socratic-map-head">
        <div>
          <span>Thinking map</span>
          <strong>{learnerAnswerCount ? `${learnerAnswerCount} answer${learnerAnswerCount === 1 ? "" : "s"} mapped` : "Awaiting first answer"}</strong>
        </div>
        <GitBranch size={22} />
      </div>

      <div className="socratic-map-grid">
        {mapSections.map((section) => {
          const nodes = map[section.key].slice(-3);
          return (
            <section key={section.key} className="socratic-map-section">
              <h3>{section.title}</h3>
              {nodes.length ? (
                nodes.map((node) => <MapNodeCard key={node.id} node={node} />)
              ) : (
                <p>{section.empty}</p>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function MapNodeCard({ node }: { node: MapNode }) {
  return (
    <article className={`socratic-map-node is-${node.tone}`}>
      <span>{node.label}</span>
      <strong>{node.detail}</strong>
    </article>
  );
}

function SocraticTurn({ message, userName }: { message: Message; userName: string }) {
  const isUser = message.role === "user";
  return (
    <article className={`socratic-turn ${isUser ? "is-user" : "is-assistant"}`}>
      <header>
        <strong>{isUser ? userName : "Coach"}</strong>
        <time>{formatBubbleDate(message.createdAt)}</time>
      </header>
      <SocraticRichText content={message.content} />
    </article>
  );
}

function SocraticRichText({ content }: { content: string }) {
  return (
    <div className="socratic-rich-text" data-no-auto-translate="true">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          table: ({ children }) => (
            <div className="bubble-table-wrap">
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {normalizeAssistantMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

function ThinkingPulse() {
  return (
    <div className="socratic-thinking" aria-live="polite">
      <span />
      <span />
      <span />
      <strong>Mapping the answer</strong>
    </div>
  );
}

function buildSocraticStartPrompt({
  target,
  targetKind,
  mode,
}: {
  target: string;
  targetKind: TargetKind;
  mode: SocraticMode;
}) {
  return [
    sessionStartMarker,
    `Target type: ${targetKind}`,
    `Mode: ${mode}`,
    `Target input: ${target}`,
    "",
    "Interpret the target internally and begin immediately with a real diagnostic question.",
    "Reply in this compact shape:",
    "Target: one sentence describing the learning target.",
    "Contract: one sentence reminding me that you will ask one question at a time and I can ask for a hint, rephrase, example, challenge, synthesis, or reveal.",
    "First question: exactly one simple diagnostic question.",
    "",
    "Rules: ask one question only; do not request more setup; do not explain the full concept yet; make the first question reveal my current mental model.",
  ].join("\n");
}

function buildCoachPrompt(
  kind: "hint" | "rephrase" | "example" | "challenge" | "synthesis" | "reveal",
  hintLevel: number,
) {
  const prompts = {
    hint: `Give hint level ${hintLevel}: ${hintSteps[Math.max(0, hintLevel - 1)]?.label ?? "Nudge"}. Do not solve the target. End with the same question or one refined question.`,
    rephrase: "Rephrase the active question in simpler language. Ask only one question.",
    example: "Give one parallel example that helps me think without solving my target. End with one question.",
    challenge: "Challenge my last answer with one counterexample, boundary case, or hidden assumption. Ask only one question.",
    synthesis: "If I am ready, ask me to state the idea in my own words. If not, ask the one question needed before final synthesis.",
    reveal: "I am asking for direct explanation. Give a concise explanation, then require me to restate the corrected idea in my own words.",
  };

  return [coachControlMarker, prompts[kind]].join("\n");
}

function getTopicStarters(topic: Topic) {
  const starters = topic.metadata?.starters;
  return Array.isArray(starters) ? starters.filter((starter): starter is string => typeof starter === "string") : [];
}

function isSessionStart(content: string) {
  return content.startsWith(sessionStartMarker);
}

function isHiddenInstruction(content: string) {
  return content.startsWith(sessionStartMarker) || content.startsWith(coachControlMarker);
}

function parseSessionStart(content?: string) {
  if (!content || !isSessionStart(content)) return undefined;
  const targetKind = normalizeTargetKind(extractLine(content, "Target type"));
  const mode = normalizeMode(extractLine(content, "Mode"));
  const target = extractLine(content, "Target input") || "Socratic target";
  return { targetKind, mode, target };
}

function normalizeTargetKind(value: string): TargetKind {
  return targetKinds.some((kind) => kind.id === value) ? (value as TargetKind) : "concept";
}

function normalizeMode(value: string): SocraticMode {
  return socraticModes.some((option) => option.id === value) ? (value as SocraticMode) : "guided";
}

function extractLine(content: string, label: string) {
  const match = content.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function buildThinkingMap(messages: Message[]): ThinkingMap {
  const map: ThinkingMap = {
    claims: [],
    assumptions: [],
    gaps: [],
    corrections: [],
    questions: [],
  };

  messages.forEach((message, index) => {
    if (message.role === "user") {
      const claim = summarize(message.content);
      if (claim) {
        map.claims.push({
          id: `${message.id}-claim`,
          label: `Claim ${map.claims.length + 1}`,
          detail: claim,
          tone: "claim",
        });
      }

      const assumption = extractAssumption(message.content);
      if (assumption) {
        map.assumptions.push({
          id: `${message.id}-assumption`,
          label: `Assumption ${map.assumptions.length + 1}`,
          detail: assumption,
          tone: "assumption",
        });
      }
    }

    if (message.role === "assistant") {
      extractLabelEntries(message.content, ["Claim", "User claim", "Learner claim"]).forEach((entry) =>
        map.claims.push({
          id: `${message.id}-claim-${map.claims.length}`,
          label: `Claim ${map.claims.length + 1}`,
          detail: entry,
          tone: "claim",
        }),
      );
      extractLabelEntries(message.content, ["Assumption", "Hidden assumption"]).forEach((entry) =>
        map.assumptions.push({
          id: `${message.id}-assumption-${map.assumptions.length}`,
          label: `Assumption ${map.assumptions.length + 1}`,
          detail: entry,
          tone: "assumption",
        }),
      );
      extractLabelEntries(message.content, ["Gap", "Missing distinction", "Contradiction"]).forEach((entry) =>
        map.gaps.push({
          id: `${message.id}-gap-${map.gaps.length}`,
          label: `Gap ${map.gaps.length + 1}`,
          detail: entry,
          tone: "gap",
        }),
      );
      extractLabelEntries(message.content, ["Correction", "Corrected idea", "Insight"]).forEach((entry) =>
        map.corrections.push({
          id: `${message.id}-correction-${map.corrections.length}`,
          label: `Correction ${map.corrections.length + 1}`,
          detail: entry,
          tone: "correction",
        }),
      );

      const question = extractQuestion(message.content);
      if (question) {
        map.questions.push({
          id: `${message.id}-question-${index}`,
          label: `Q${map.questions.length + 1}`,
          detail: question,
          tone: "question",
        });
      }
    }
  });

  return map;
}

function extractLabelEntries(content: string, labels: string[]) {
  const lines = content.split(/\r?\n/);
  const patterns = labels.map(
    (label) => new RegExp(`^\\s*(?:[-*]\\s*)?\\*{0,2}${escapeRegExp(label)}\\*{0,2}:\\s*(.+)$`, "i"),
  );
  const entries: string[] = [];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) entries.push(cleanInline(match[1]));
    }
  }
  return entries.filter(Boolean).slice(-4);
}

function extractQuestion(content: string) {
  const labelled = extractField(content, ["First question", "Next question", "Question"]);
  if (labelled) return cleanQuestion(labelled);

  const questions = content.match(/[^.!?\n][^?\n]*\?/g);
  return cleanQuestion(questions?.at(-1) ?? "");
}

function extractField(content: string, labels: string[]) {
  const patterns = labels.map(
    (label) => new RegExp(`^\\s*(?:[-*]\\s*)?\\*{0,2}${escapeRegExp(label)}\\*{0,2}:\\s*(.+)$`, "im"),
  );
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) return cleanInline(match[1]);
  }
  return "";
}

function extractAssumption(content: string) {
  const because = content.match(/\bbecause\b\s+(.+)/i)?.[1];
  if (because) return `Because ${summarize(because, 18)}`;
  const assume = content.match(/\bassum(?:e|ing|ption)\b\s+(.+)/i)?.[1];
  if (assume) return summarize(assume, 18);
  return "";
}

function extractMisconception(content: string) {
  const explicit = extractField(content, ["Possible confusion", "Possible gap", "Possible issue"]);
  if (explicit) return explicit;
  const lower = content.toLowerCase();
  if (lower.includes("price") && lower.includes("cost")) return "Possible confusion: price vs cost";
  if (lower.includes("correlation") && lower.includes("causation")) return "Possible issue: correlation vs causation";
  if (lower.includes("short run") && lower.includes("long run")) return "Possible gap: short run vs long run";
  if (lower.includes("assumption")) return "Current focus: hidden assumption";
  return "";
}

function buildProgress(messages: Message[], map: ThinkingMap) {
  const text = messages.map((message) => message.content.toLowerCase()).join("\n");
  const learnerAnswers = messages.filter((message) => message.role === "user").length;
  return [
    { label: "Initial intuition", active: learnerAnswers > 0 },
    {
      label: "Distinction found",
      active:
        map.corrections.length > 0 ||
        map.gaps.length > 0 ||
        /\bdistinction|different|contrast|refine\b/.test(text),
    },
    { label: "Counterexample handled", active: /\bcounterexample|boundary|prove.*false|challenge\b/.test(text) },
    { label: "Transfer achieved", active: /\btransfer|apply|new case|another domain\b/.test(text) },
    { label: "Final synthesis", active: /\bfinal synthesis|in your own words|restate|final answer\b/.test(text) },
  ];
}

function summarize(content: string, maxWords = 20) {
  const cleaned = cleanInline(content)
    .replace(new RegExp(`^${escapeRegExp(coachControlMarker)}`, "i"), "")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}...` : words.join(" ");
}

function cleanQuestion(content: string) {
  return cleanInline(content).replace(/^["“]|["”]$/g, "");
}

function cleanInline(content: string) {
  return content
    .replace(/\*\*/g, "")
    .replace(/^[-*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAssistantMarkdown(content: string) {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression: string) => `\n\n$$\n${expression.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression: string) => `$${expression.trim()}$`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

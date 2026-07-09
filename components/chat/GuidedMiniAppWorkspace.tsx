"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useReducer,
  useState,
} from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  FileText,
  Gauge,
  Gavel,
  History,
  Landmark,
  MapPin,
  MessageCircle,
  Scale,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  StickyNote,
  Thermometer,
  UserRound,
  Users,
} from "lucide-react";
import type { ChatMessage as Message } from "@/components/chat/chat-message-model";
import { ClockIcon } from "@/components/chat/ClockIcon";
import {
  CoachChatSession,
  type CoachChatAction,
} from "@/components/chat/CoachChatSession";
import { CollaborativeInstructionWorkspace } from "@/components/chat/CollaborativeInstructionWorkspace";
import { MessageCard } from "@/components/chat/MessageCard";
import { MiniIcon } from "@/components/chat/MiniIcon";
import type { MiniAppIcon } from "@/components/chat/mini-icon-types";
import { displayMessages } from "@/components/chat/message-display";
import { mergeStateReducer } from "@/components/chat/state-utils";
import { ThinkingMarker } from "@/components/chat/ThinkingMarker";
import { TopicIntroCard } from "@/components/chat/TopicIntroCard";
import {
  type Topic,
  type TopicMetadata,
  topicIntroProps,
} from "@/components/chat/topic-model";
import { buildMiniAppInstruction } from "@/lib/ai/visible-content";

type MiniMode = Exclude<TopicMetadata["uiMode"], "chat" | "quiz" | "flashcards" | "study-timer" | "focus-music" | "game-arena">;

type MiniAppConfig = {
  icon: MiniAppIcon;
  eyebrow: string;
  setupTitle: string;
  setupBody: string;
  primaryLabel: string;
  primaryPlaceholder: string;
  secondaryLabel: string;
  secondaryPlaceholder: string;
  notesLabel: string;
  notesPlaceholder: string;
  cta: string;
  examples: string[];
  panels: Array<{ title: string; body: string }>;
  milestones: string[];
  buildPrompt: (input: { primary: string; secondary: string; notes: string }) => string;
};

const miniAppConfigs: Record<MiniMode, MiniAppConfig> = {
  "time-travel": {
    icon: "compass",
    eyebrow: "Time Travel Console",
    setupTitle: "Choose the destination.",
    setupBody: "Set a place, period, and mission. Your guide will keep the trip bounded to the era and mark speculation clearly.",
    primaryLabel: "Where and when",
    primaryPlaceholder: "Renaissance Florence in 1490",
    secondaryLabel: "Traveler role",
    secondaryPlaceholder: "Apprentice artist, merchant, visitor...",
    notesLabel: "Learning mission",
    notesPlaceholder: "Daily life, inventions, politics, food...",
    cta: "Open the portal",
    examples: ["Mohenjo-daro around 2500 BCE", "Baghdad during the House of Wisdom", "Tokyo in 2120"],
    panels: [
      { title: "Era Passport", body: "Arrival date, role, norms, and what knowledge belongs in that period." },
      { title: "Scene Choices", body: "Markets, homes, workshops, courts, maps, and decision points." },
      { title: "Timeline Log", body: "Important events, facts learned, and uncertainty notes stay visible." },
    ],
    milestones: ["Arrival", "Explore", "Log", "Choose next"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Take me on a time-travel learning session to ${primary}.`,
        secondary ? `My traveler role: ${secondary}.` : undefined,
        notes ? `My learning mission: ${notes}.` : undefined,
        "Start with an era passport, a vivid arrival scene, three choices for what to do next, and a compact timeline log.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  "historical-person": {
    icon: "landmark",
    eyebrow: "Historical Conversation Studio",
    setupTitle: "Invite a figure into the room.",
    setupBody: "Pick a person and a focus. The app separates in-character replies from context notes and record limits.",
    primaryLabel: "Historical figure",
    primaryPlaceholder: "Ada Lovelace, Cleopatra, B. R. Ambedkar...",
    secondaryLabel: "Conversation focus",
    secondaryPlaceholder: "Science, leadership, democracy, daily life...",
    notesLabel: "What you want to ask",
    notesPlaceholder: "A first question or angle",
    cta: "Begin the conversation",
    examples: ["Ada Lovelace on imagination", "Nelson Mandela on courage", "Hypatia on learning"],
    panels: [
      { title: "Persona Card", body: "Era, public worldview, voice, and what records can support." },
      { title: "Ask About", body: "Question prompts that deepen the exchange without turning it into a lecture." },
      { title: "Context Notes", body: "Short factual notes clarify uncertainty, bias, and interpretation." },
    ],
    milestones: ["Persona", "Question", "Reply", "Context"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Start a historically grounded conversation with ${primary}.`,
        secondary ? `Focus the conversation on ${secondary}.` : undefined,
        notes ? `My opening question or angle: ${notes}.` : undefined,
        "Begin with a persona card, then answer in character with brief context notes and suggested follow-up questions.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  "interactive-instruction": {
    icon: "lesson",
    eyebrow: "Adaptive Lesson Loop",
    setupTitle: "Build a lesson that reacts to you.",
    setupBody: "Choose a concept and starting level. Your tutor teaches a small piece, checks it, then adjusts after every reply.",
    primaryLabel: "Concept",
    primaryPlaceholder: "Fractions, supply and demand, Newton's laws...",
    secondaryLabel: "Starting level",
    secondaryPlaceholder: "Beginner, exam prep, advanced, age 12...",
    notesLabel: "Goal",
    notesPlaceholder: "Understand basics, solve problems, revise fast...",
    cta: "Start the loop",
    examples: ["Teach me ratios", "Explain electric circuits", "Help me learn supply and demand"],
    panels: [
      { title: "Mini Lesson", body: "One short concept chunk at a time, with examples that fit your level." },
      { title: "Quick Check", body: "A single check question before moving forward." },
      { title: "Mastery Meter", body: "Difficulty rises or softens based on your response." },
    ],
    milestones: ["Teach", "Check", "Adapt", "Next step"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Teach me ${primary} through an interactive lesson loop.`,
        secondary ? `My starting level: ${secondary}.` : undefined,
        notes ? `My goal: ${notes}.` : undefined,
        "Start with a tiny lesson, one check question, a mastery meter, and wait for my answer before continuing.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  "collaborative-instruction": {
    icon: "collab",
    eyebrow: "Collaborative Study Room",
    setupTitle: "Set the shared task.",
    setupBody: "Your buddy works beside you: you contribute ideas, the app organizes them, and both of you checkpoint progress.",
    primaryLabel: "Shared goal",
    primaryPlaceholder: "Understand photosynthesis, write an essay plan...",
    secondaryLabel: "What you already know",
    secondaryPlaceholder: "A few facts, a rough draft, where you are stuck...",
    notesLabel: "How we should work",
    notesPlaceholder: "Step by step, brainstorm first, solve together...",
    cta: "Open the study room",
    examples: ["Plan a climate essay", "Work through fractions", "Build a science project idea"],
    panels: [
      { title: "Task Board", body: "A shared goal, next actions, and what is already done." },
      { title: "Your Contribution", body: "You add ideas first so the buddy can build with you." },
      { title: "Checkpoint", body: "Short summaries keep both sides aligned before moving on." },
    ],
    milestones: ["Goal", "Your move", "Buddy build", "Checkpoint"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Start a collaborative instruction study-room session for this goal: ${primary}.`,
        secondary ? `What I already know: ${secondary}.` : undefined,
        notes ? `Preferred working style: ${notes}.` : undefined,
        "Create a shared task board, ask for my first contribution, then work beside me with checkpoints.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  "socratic-instruction": {
    icon: "socratic",
    eyebrow: "Socratic Question Ladder",
    setupTitle: "Start with a question, not a lecture.",
    setupBody: "Name the topic and your current guess. The app builds a ladder of questions, hints, evidence, and synthesis.",
    primaryLabel: "Topic or question",
    primaryPlaceholder: "Why do seasons happen?",
    secondaryLabel: "Current hypothesis",
    secondaryPlaceholder: "What you think so far",
    notesLabel: "Where you feel stuck",
    notesPlaceholder: "Definitions, evidence, first principles...",
    cta: "Climb the ladder",
    examples: ["What makes an argument valid?", "Why did empires fall?", "How do vaccines work?"],
    panels: [
      { title: "Current Hypothesis", body: "State your starting idea so the tutor has something to test." },
      { title: "Hint Ladder", body: "Small nudges arrive before direct explanations." },
      { title: "Synthesis Locked", body: "The final summary waits until you have done real thinking." },
    ],
    milestones: ["Hypothesis", "Question", "Hint", "Synthesis"],
    buildPrompt: ({ primary, secondary, notes }) =>
      [
        `Guide me Socratically on: ${primary}.`,
        secondary ? `My current hypothesis: ${secondary}.` : "Ask me for my current hypothesis first.",
        notes ? `Where I feel stuck: ${notes}.` : undefined,
        "Ask one question at a time, track assumptions and evidence, offer hints on request, and do not synthesize until I have tried.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
};

const historicalEngagementModes = [
  {
    id: "interview",
    label: "Interview",
    body: "Ask direct questions and let the historian clarify evidence when needed.",
    role: "historical interviewer",
  },
  {
    id: "debate",
    label: "Debate",
    body: "Challenge ideas while the person defends the worldview of their moment.",
    role: "respectful but challenging interlocutor",
  },
  {
    id: "apprenticeship",
    label: "Apprenticeship",
    body: "Learn how they thought, worked, planned, wrote, governed, or experimented.",
    role: "apprentice studying their method",
  },
  {
    id: "council-room",
    label: "Council room",
    body: "Ask for advice through their period worldview and constraints.",
    role: "advisor seeking counsel",
  },
  {
    id: "cross-examination",
    label: "Cross-examination",
    body: "Confront contradictions, evasions, and consequences with evidence support.",
    role: "prosecutor testing claims",
  },
  {
    id: "day-in-the-life",
    label: "Day-in-the-life",
    body: "Follow an ordinary or decisive day with setting, pressure, and choices.",
    role: "observer inside the scene",
  },
  {
    id: "moral-tribunal",
    label: "Moral tribunal",
    body: "Evaluate legacy without flattening context into excuse or condemnation.",
    role: "tribunal questioner",
  },
  {
    id: "strategy-room",
    label: "Strategy room",
    body: "Reconstruct a decision, alternatives, constraints, and outcomes.",
    role: "strategy analyst",
  },
] as const;

type HistoricalEngagementModeId = (typeof historicalEngagementModes)[number]["id"];

const historicalTimeSliceOptions = [
  "Ask the historian to propose time slices",
  "Formative years before public power",
  "At the decisive turning point",
  "At peak influence or authority",
  "During crisis, exile, trial, or imprisonment",
  "Late-life retrospective before death",
];

const historianVisibilityOptions = [
  {
    value: "medium",
    label: "Balanced",
    body: "Flag important context without crowding every reply.",
  },
  {
    value: "high",
    label: "Evidence-heavy",
    body: "Show more uncertainty, anachronism, and source-boundary notes.",
  },
  {
    value: "low",
    label: "Immersive",
    body: "Keep the sidecar quieter unless something needs correction.",
  },
];

const historicalQuickStarts = [
  {
    label: "Challenge Churchill on empire",
    startType: "direct",
    person: "Winston Churchill",
    timeSlice: "Wartime prime minister in 1940",
    mode: "cross-examination" as HistoricalEngagementModeId,
    setting: "Cabinet room during wartime Britain",
    userRole: "citizen-prosecutor testing imperial assumptions",
    goal: "Challenge the tension between fighting tyranny in Europe and defending empire.",
  },
  {
    label: "Meet Ambedkar in committee",
    startType: "direct",
    person: "B. R. Ambedkar",
    timeSlice: "1946-1949 constitution-making period",
    mode: "debate" as HistoricalEngagementModeId,
    setting: "committee room in Delhi",
    userRole: "MBA student studying institutional design",
    goal: "Debate safeguards, social democracy, and the cost of constitutional compromise.",
  },
  {
    label: "Find an education changer",
    startType: "discover",
    person: "someone who changed education and faced serious opposition",
    timeSlice: "Ask the historian to propose time slices",
    mode: "interview" as HistoricalEngagementModeId,
    setting: "",
    userRole: "curious learner",
    goal: "Suggest candidates with strong evidence and vivid settings.",
  },
];

const historicalDossierActions = [
  {
    title: "Timeline so far",
    body: "Events the person has already lived through.",
    prompt: "Open the timeline so far for this exact time slice. Separate documented events from contested interpretation.",
  },
  {
    title: "Beliefs and blind spots",
    body: "What they value, defend, miss, or refuse.",
    prompt: "Show the person's major beliefs at this time, their blind spots, and what they would likely resist understanding.",
  },
  {
    title: "Allies and enemies",
    body: "Who pressures them, supports them, or threatens them.",
    prompt: "Map allies, enemies, critics, patrons, and pressure groups around this person at this moment.",
  },
  {
    title: "Evidence drawer",
    body: "Sources, confidence, uncertainty, and forbidden quotes.",
    prompt: "Open the evidence drawer. Label high-confidence facts, plausible reconstructions, contested claims, and things you must not fabricate.",
  },
  {
    title: "Questions to ask",
    body: "Openings that produce a better encounter.",
    prompt: "Recommend opening questions for this encounter, grouped by interview, debate, contradiction, and legacy.",
  },
];

const historicalModeSwitches = [
  {
    label: "Historian explains",
    prompt: "Step out of character briefly. Explain the historical context, evidence quality, and uncertainties behind the last exchange.",
  },
  {
    label: "Debate harder",
    prompt: "Increase the challenge. Have the historical person defend their worldview more forcefully while the historian tracks weak claims.",
  },
  {
    label: "Ask as student",
    prompt: "Reframe my next question as a student trying to understand the mental model, not just the biography.",
  },
  {
    label: "Compare legacy",
    prompt: "Compare intentions, contemporary criticism, later consequences, and modern judgement without reducing the person to hero or villain.",
  },
];

function historicalModeIcon(mode: HistoricalEngagementModeId) {
  switch (mode) {
    case "interview":
      return MessageCircle;
    case "debate":
      return Scale;
    case "apprenticeship":
      return BookOpenCheck;
    case "council-room":
      return Users;
    case "cross-examination":
      return Gavel;
    case "day-in-the-life":
      return History;
    case "moral-tribunal":
      return AlertTriangle;
    case "strategy-room":
      return Gauge;
    default:
      return Landmark;
  }
}

function buildHistoricalEncounterPrompt({
  startType,
  personOrTheme,
  timeSlice,
  setting,
  mode,
  userRole,
  openingGoal,
  historianVisibility,
}: {
  startType: "direct" | "discover";
  personOrTheme: string;
  timeSlice: string;
  setting: string;
  mode: HistoricalEngagementModeId;
  userRole: string;
  openingGoal: string;
  historianVisibility: string;
}) {
  const engagement = historicalEngagementModes.find((candidate) => candidate.id === mode) ?? historicalEngagementModes[1];
  const needsTimeSlice = timeSlice === historicalTimeSliceOptions[0];

  return buildMiniAppInstruction({
    visible:
      startType === "discover"
        ? `Find a historical person: ${personOrTheme}`
        : `Historical audience: ${personOrTheme} (${needsTimeSlice ? "choose time slice" : timeSlice})`,
    instructions: [
      "Open the Historical Person mini app as a staged historical audience with a living dossier.",
      "Do not run this as a generic chatbot or a famous-person costume.",
      `Start type: ${startType === "discover" ? "vague discovery request" : "direct person request"}.`,
      startType === "discover"
        ? `Discovery request: ${personOrTheme}. Suggest 3 to 5 historical people first. Each card must include name, era, why they matter, best conversation modes, controversy level, evidence quality, and a fitting setting. Ask me to choose before building a persona.`
        : `Requested person or encounter: ${personOrTheme}.`,
      needsTimeSlice
        ? "Time slice: not chosen yet. If a specific person is named, offer 4 to 5 historically meaningful versions of this person before any in-character dialogue. Explain how each version changes the worldview, stakes, and setting."
        : `Selected time slice: ${timeSlice}. If this slice is too broad, narrow it once with 2 or 3 historically meaningful options before the encounter begins.`,
      setting ? `Preferred setting: ${setting}.` : "Preferred setting: choose a historically fitting room, court, battlefield tent, study, prison, salon, workshop, public square, or other concrete place.",
      `Engagement mode: ${engagement.label}. The user's relationship to the person is: ${userRole || engagement.role}.`,
      openingGoal ? `User's purpose or opening angle: ${openingGoal}.` : "User's purpose: help them choose sharp opening questions.",
      `Historian sidecar visibility: ${historianVisibility}.`,
      "Required flow:",
      "- Before the person speaks, build the room: where we are, year or date range, what has happened so far, current pressures, beliefs, blind spots, and historian uncertainties.",
      "- Create a dossier wall with: timeline so far, personal stakes, allies and enemies, major beliefs at this time, blind spots, known writings or speeches, current pressure, historical context, evidence quality, and recommended opening questions.",
      "- Maintain two layers after the encounter begins: in-character voice bounded by the time slice, and historian sidecar notes that distinguish documented fact, plausible reconstruction, contested interpretation, modern paraphrase, and fictionalized dialogue.",
      "- The historical person may resist, challenge, evade, ask questions back, reject false premises, or reveal period constraints. They should not be infinitely agreeable.",
      "- Do not fabricate exact quotations. If a direct quotation is not sourced in the conversation, mark generated wording as a modernized paraphrase or reconstructed dialogue.",
      "- Do not sanitize harmful views, and do not glorify oppression, casteism, racism, slavery, misogyny, authoritarianism, or violence. Context is not automatic excuse.",
      "- Do not let the persona give medical, legal, financial, or harmful advice as authoritative guidance.",
      "First response format:",
      "1. If discovery or time-slice choice is needed, show choices and stop.",
      "2. Otherwise show the dossier wall first, then invite me to begin with one of the recommended questions.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export function GuidedMiniAppWorkspace({
  topic,
  mode,
  language,
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
  mode: MiniMode;
  language: string;
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
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [notes, setNotes] = useState("");
  const visibleMessages = displayMessages(messages);
  const hasSession = messages.some((message) => message.role !== "system") || sending || awaitingResponse;

  if (mode === "collaborative-instruction") {
    return (
      <CollaborativeInstructionWorkspace
        topic={topic}
        language={language}
        userName={userName}
        messages={messages}
        input={input}
        sending={sending}
        awaitingResponse={awaitingResponse}
        inputRef={inputRef}
        listRef={listRef}
        onInput={onInput}
        onSend={onSend}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onStop={onStop}
        onReset={onReset}
      />
    );
  }

  if (mode === "historical-person") {
    return (
      <HistoricalPersonWorkspace
        topic={topic}
        language={language}
        userName={userName}
        messages={messages}
        input={input}
        sending={sending}
        awaitingResponse={awaitingResponse}
        inputRef={inputRef}
        listRef={listRef}
        onInput={onInput}
        onSend={onSend}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onStop={onStop}
        onReset={onReset}
      />
    );
  }

  const config = miniAppConfigs[mode];

  function startMiniApp(event?: FormEvent) {
    event?.preventDefault();
    if (!primary.trim() || sending) return;
    void onSend(
      buildMiniAppInstruction({
        visible: `${topic.name}: ${primary.trim()}`,
        instructions: config.buildPrompt({
          primary: primary.trim(),
          secondary: secondary.trim(),
          notes: notes.trim(),
        }),
      }),
    );
  }

  if (hasSession) {
    return (
      <CoachChatSession
        eyebrow={config.eyebrow}
        title={primary.trim() || topic.name}
        subtitle={config.milestones.join(" -> ")}
        userName={userName}
        coachName="Coach"
        placeholder={topic.inputboxText}
        messages={visibleMessages}
        input={input}
        sending={sending}
        awaitingResponse={awaitingResponse}
        inputRef={inputRef}
        listRef={listRef}
        details={[
          { title: config.primaryLabel, body: primary.trim() || "Set in the opening message", icon: BookOpenCheck },
          { title: config.secondaryLabel, body: secondary.trim() || "Use chat to adjust this", icon: SlidersHorizontal },
          { title: config.notesLabel, body: notes.trim() || "No extra notes", icon: StickyNote },
          ...config.panels.map((panel) => ({ title: panel.title, body: panel.body, icon: FileText })),
        ]}
        resetLabel="Change setup"
        onInput={onInput}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onStop={onStop}
        onReset={onReset}
      />
    );
  }

  return (
    <main className="inspir-workspace inspir-mini-workspace">
      <div ref={listRef} className="inspir-mini-scroll app-scrollbar">
        {!hasSession ? (
          <section className="inspir-mini-start">
            <TopicIntroCard {...topicIntroProps(topic)} />
            <div className="inspir-mini-start-copy">
              <span>{config.eyebrow}</span>
              <h2>{config.setupTitle}</h2>
              <p>{config.setupBody}</p>
            </div>
            <form className="inspir-mini-start-form" onSubmit={startMiniApp}>
              <MiniIcon icon={config.icon} />
              <label>
                <span>{config.primaryLabel}</span>
                <input
                  value={primary}
                  onChange={(event) => setPrimary(event.target.value)}
                  placeholder={config.primaryPlaceholder}
                  disabled={sending}
                />
              </label>
              <label>
                <span>{config.secondaryLabel}</span>
                <input
                  value={secondary}
                  onChange={(event) => setSecondary(event.target.value)}
                  placeholder={config.secondaryPlaceholder}
                  disabled={sending}
                />
              </label>
              <label>
                <span>{config.notesLabel}</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={config.notesPlaceholder}
                  disabled={sending}
                  rows={3}
                />
              </label>
              <button type="submit" disabled={!primary.trim() || sending}>
                {config.cta}
              </button>
            </form>
            <div className="inspir-mini-example-row">
              {config.examples.map((example) => (
                <button key={example} type="button" onClick={() => setPrimary(example)}>
                  <Sparkles size={15} />
                  <span>{example}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="inspir-mini-session">
            <aside className="inspir-mini-side">
              <div className="inspir-mini-side-head">
                <MiniIcon icon={config.icon} />
                <div>
                  <span>{config.eyebrow}</span>
                  <strong>{topic.name}</strong>
                </div>
              </div>
              <div className="inspir-mini-side-grid">
                {config.panels.map((panel) => (
                  <article key={panel.title}>
                    <strong>{panel.title}</strong>
                    <span>{panel.body}</span>
                  </article>
                ))}
              </div>
              <button type="button" onClick={onReset} className="inspir-mini-new-session">
                New session
              </button>
            </aside>
            <div className="inspir-mini-conversation">
              <header className="inspir-mini-stage-header">
                <div>
                  <span>Live Session</span>
                  <strong>{config.milestones.join(" -> ")}</strong>
                </div>
                <div className="inspir-mini-stage-pills">
                  {config.milestones.map((milestone, index) => (
                    <span key={milestone} className={index === 0 ? "is-active" : ""}>
                      {milestone}
                    </span>
                  ))}
                </div>
              </header>
              <div className="inspir-message-stack inspir-mini-message-stack">
                {visibleMessages.map((message) => (
                  <MessageCard key={message.id} message={message} userLabel={userName} />
                ))}
                {awaitingResponse ? (
                  <ThinkingMarker label="Thinking" />
                ) : null}
              </div>
            </div>
          </section>
        )}
      </div>
      {hasSession ? (
        <form onSubmit={onSubmit} className="inspir-composer">
          <div className="inspir-composer-inner">
            <textarea
              aria-label="Debate message"
              ref={inputRef}
              value={input}
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={topic.inputboxText}
              disabled={sending}
              className="inspir-composer-input"
              rows={1}
            />
            <button
              type={sending ? "button" : "submit"}
              onClick={sending ? onStop : undefined}
              disabled={!sending && !input.trim()}
              aria-label={sending ? "Stop response" : "Send message"}
              className="inspir-send-button"
            >
              {sending ? <Square size={18} fill="currentColor" /> : <Send size={23} />}
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}

type HistoricalState = {
  startType: "direct" | "discover";
  personOrTheme: string;
  timeSlice: string;
  customTimeSlice: string;
  engagementMode: HistoricalEngagementModeId;
  setting: string;
  userRole: string;
  openingGoal: string;
  historianVisibility: string;
};

type HistoricalPersonWorkspaceProps = {
  topic: Topic;
  language: string;
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
};

function HistoricalPersonWorkspace(props: HistoricalPersonWorkspaceProps) {
  return useHistoricalPersonWorkspace(props);
}

function useHistoricalPersonWorkspace({
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
}: HistoricalPersonWorkspaceProps) {
  const [
    {
      startType,
      personOrTheme,
      timeSlice,
      customTimeSlice,
      engagementMode,
      setting,
      userRole,
      openingGoal,
      historianVisibility,
    },
    updateHistoricalState,
  ] = useReducer(
    mergeStateReducer<HistoricalState>,
    {
      startType: "direct",
      personOrTheme: "",
      timeSlice: historicalTimeSliceOptions[0],
      customTimeSlice: "",
      engagementMode: "debate",
      setting: "",
      userRole: "respectful but challenging interlocutor",
      openingGoal: "",
      historianVisibility: "medium",
    },
  );
  const visibleMessages = displayMessages(messages);
  const hasSession = messages.some((message) => message.role !== "system") || sending || awaitingResponse;
  const selectedMode =
    historicalEngagementModes.find((mode) => mode.id === engagementMode) ?? historicalEngagementModes[1];
  const selectedTimeSlice = customTimeSlice.trim() || timeSlice;

  function applyQuickStart(example: (typeof historicalQuickStarts)[number]) {
    updateHistoricalState({
      startType: example.startType as "direct" | "discover",
      personOrTheme: example.person,
      timeSlice: historicalTimeSliceOptions.includes(example.timeSlice)
        ? example.timeSlice
        : historicalTimeSliceOptions[0],
      customTimeSlice: historicalTimeSliceOptions.includes(example.timeSlice) ? "" : example.timeSlice,
      engagementMode: example.mode,
      setting: example.setting,
      userRole: example.userRole,
      openingGoal: example.goal,
    });
  }

  function selectEngagementMode(mode: (typeof historicalEngagementModes)[number]) {
    updateHistoricalState((current) => {
      const currentlyPreset = historicalEngagementModes.some((candidate) => candidate.role === current.userRole);
      return {
        engagementMode: mode.id,
        userRole: !current.userRole.trim() || currentlyPreset ? mode.role : current.userRole,
      };
    });
  }

  function startHistoricalEncounter(event?: FormEvent) {
    event?.preventDefault();
    if (!personOrTheme.trim() || sending) return;
    void onSend(
      buildHistoricalEncounterPrompt({
        startType,
        personOrTheme: personOrTheme.trim(),
        timeSlice: selectedTimeSlice,
        setting: setting.trim(),
        mode: engagementMode,
        userRole: userRole.trim() || selectedMode.role,
        openingGoal: openingGoal.trim(),
        historianVisibility,
      }),
    );
  }

  if (hasSession) {
    const encounterTitle =
      personOrTheme.trim() ||
      visibleMessages.find((message) => message.role === "user")?.content.replace(/^Historical audience:\s*/i, "") ||
      topic.name;
    const actions: CoachChatAction[] = [
      ...historicalDossierActions.map((action) => ({
        label: action.title,
        icon: FileText,
        disabled: sending,
        onClick: () =>
          void onSend(
            buildMiniAppInstruction({
              visible: action.title,
              instructions: action.prompt,
            }),
          ),
      })),
      ...historicalModeSwitches.map((switcher) => ({
        label: switcher.label,
        icon: Scale,
        disabled: sending,
        onClick: () =>
          void onSend(
            buildMiniAppInstruction({
              visible: switcher.label,
              instructions: switcher.prompt,
            }),
          ),
      })),
      {
        label: "Generate debrief",
        icon: FileText,
        disabled: sending,
        onClick: () =>
          void onSend(
            buildMiniAppInstruction({
              visible: "Generate debrief",
              instructions:
                "End this session with a debrief artifact: what the person argued, what I challenged, strongest insight, weakest claim, historical context learned, open questions, recommended next encounters, and any saved quotes clearly marked as generated paraphrases unless sourced.",
            }),
          ),
      },
    ];

    return (
      <CoachChatSession
        eyebrow="Historical audience"
        title={encounterTitle}
        subtitle={`${selectedTimeSlice} - ${selectedMode.label}`}
        userName={userName}
        coachName="Historian coach"
        placeholder="Ask, challenge, request evidence, or open a dossier item..."
        messages={visibleMessages}
        input={input}
        sending={sending}
        awaitingResponse={awaitingResponse}
        inputRef={inputRef}
        listRef={listRef}
        actions={actions}
        details={[
          { title: "Time slice", body: selectedTimeSlice, icon: History },
          { title: "Setting", body: setting.trim() || "Historically fitted setting", icon: MapPin },
          { title: "Your role", body: userRole || selectedMode.role, icon: UserRound },
          { title: "Mode", body: selectedMode.body, icon: historicalModeIcon(selectedMode.id) },
          {
            title: "Historian sidecar",
            body: historianVisibilityOptions.find((option) => option.value === historianVisibility)?.body ?? "Evidence labels stay visible.",
            icon: ShieldCheck,
          },
          { title: "Boundary", body: "Generated dialogue is simulation, not authenticated quotation.", icon: AlertTriangle },
        ]}
        resetLabel="Change audience"
        onInput={onInput}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        onStop={onStop}
        onReset={onReset}
      />
    );
  }

  return (
    <main className="inspir-workspace historical-workspace">
      <div ref={listRef} className="historical-scroll app-scrollbar">
        {!hasSession ? (
          <section className="historical-start">
            <div className="historical-start-main">
              <TopicIntroCard {...topicIntroProps(topic)} />
              <header className="historical-audience-hero">
                <span>Historical Audience Chamber</span>
                <h2>Stage the person, year, room, and relationship.</h2>
                <p>
                  Build a bounded encounter with a dossier first, then speak through an
                  in-character layer and a historian sidecar.
                </p>
                <div className="historical-contract-strip" aria-label="Historical safeguards">
                  <span>
                    <ShieldCheck size={15} /> Time slice required
                  </span>
                  <span>
                    <FileText size={15} /> No invented quotes
                  </span>
                  <span>
                    <AlertTriangle size={15} /> Context is not endorsement
                  </span>
                </div>
              </header>
              <form className="historical-setup" onSubmit={startHistoricalEncounter}>
                <div className="historical-segmented" aria-label="Start type">
                  <button
                    type="button"
                    aria-pressed={startType === "direct"}
                    className={startType === "direct" ? "is-active" : ""}
                    onClick={() => updateHistoricalState({ startType: "direct" })}
                  >
                    <UserRound size={17} />
                    <span>Direct person</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={startType === "discover"}
                    className={startType === "discover" ? "is-active" : ""}
                    onClick={() => updateHistoricalState({ startType: "discover" })}
                  >
                    <Search size={17} />
                    <span>Vague start</span>
                  </button>
                </div>

                <label className="historical-field">
                  <span>{startType === "direct" ? "Person or challenge" : "What kind of person?"}</span>
                  <textarea
                    value={personOrTheme}
                    onChange={(event) => updateHistoricalState({ personOrTheme: event.target.value })}
                    placeholder={
                      startType === "direct"
                        ? "Napoleon after Austerlitz, Ambedkar in the Constitution committee..."
                        : "Someone who changed education, a leader from a collapsing empire..."
                    }
                    disabled={sending}
                    rows={2}
                  />
                </label>

                <div className="historical-field-grid">
                  <label className="historical-field">
                    <span>Setting</span>
                    <input
                      value={setting}
                      onChange={(event) => updateHistoricalState({ setting: event.target.value })}
                      placeholder="Court, study, prison cell, battlefield tent..."
                      disabled={sending}
                    />
                  </label>
                  <label className="historical-field">
                    <span>Your role</span>
                    <input
                      value={userRole}
                      onChange={(event) => updateHistoricalState({ userRole: event.target.value })}
                      placeholder="Student, rival, journalist, citizen..."
                      disabled={sending}
                    />
                  </label>
                </div>

                <section className="historical-form-block" aria-labelledby="time-slice-label">
                  <div className="historical-form-heading">
                    <ClockIcon />
                    <div>
                      <strong id="time-slice-label">Time slice</strong>
                      <span>The version of a person matters more than the name.</span>
                    </div>
                  </div>
                  <div className="historical-chip-grid">
                    {historicalTimeSliceOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={!customTimeSlice && timeSlice === option ? "is-active" : ""}
                        aria-pressed={!customTimeSlice && timeSlice === option}
                        onClick={() => {
                          updateHistoricalState({ timeSlice: option, customTimeSlice: "" });
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <label className="historical-field">
                    <span>Or write a precise slice</span>
                    <input
                      value={customTimeSlice}
                      onChange={(event) => updateHistoricalState({ customTimeSlice: event.target.value })}
                      placeholder="Salt March strategist, St. Helena retrospective, 1946 committee room..."
                      disabled={sending}
                    />
                  </label>
                </section>

                <section className="historical-form-block" aria-labelledby="engagement-label">
                  <div className="historical-form-heading">
                    <MessageCircle size={20} />
                    <div>
                      <strong id="engagement-label">Engagement contract</strong>
                      <span>Choose the relationship and the purpose of the room.</span>
                    </div>
                  </div>
                  <div className="historical-mode-grid">
                    {historicalEngagementModes.map((mode) => {
                      const Icon = historicalModeIcon(mode.id);
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          aria-pressed={engagementMode === mode.id}
                          className={engagementMode === mode.id ? "is-active" : ""}
                          onClick={() => selectEngagementMode(mode)}
                        >
                          <Icon size={18} />
                          <strong>{mode.label}</strong>
                          <span>{mode.body}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <div className="historical-field-grid">
                  <section className="historical-form-block" aria-label="Historian visibility">
                    <div className="historical-form-heading">
                      <FileText size={20} />
                      <div>
                        <strong>Historian sidecar</strong>
                        <span>How visibly should evidence appear?</span>
                      </div>
                    </div>
                    <div className="historical-visibility-grid">
                      {historianVisibilityOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={historianVisibility === option.value}
                          className={historianVisibility === option.value ? "is-active" : ""}
                          onClick={() => updateHistoricalState({ historianVisibility: option.value })}
                        >
                          <strong>{option.label}</strong>
                          <span>{option.body}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                  <label className="historical-field historical-opening-field">
                    <span>Opening purpose</span>
                    <textarea
                      value={openingGoal}
                      onChange={(event) => updateHistoricalState({ openingGoal: event.target.value })}
                      placeholder="What do you want to ask, test, learn, or confront?"
                      disabled={sending}
                      rows={5}
                    />
                  </label>
                </div>

                <button type="submit" className="historical-primary-action" disabled={!personOrTheme.trim() || sending}>
                  Build the audience
                </button>
              </form>
            </div>

            <aside className="historical-start-rail">
              <section className="historical-rail-panel">
                <div className="historical-rail-heading">
                  <Sparkles size={20} />
                  <strong>Fast starts</strong>
                </div>
                <div className="historical-quick-list">
                  {historicalQuickStarts.map((example) => (
                    <button key={example.label} type="button" onClick={() => applyQuickStart(example)}>
                      <span>{example.label}</span>
                      <small>{example.timeSlice}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section className="historical-rail-panel">
                <div className="historical-rail-heading">
                  <Landmark size={20} />
                  <strong>Dossier wall includes</strong>
                </div>
                <div className="historical-rail-list">
                  {historicalDossierActions.map((item) => (
                    <article key={item.title}>
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                    </article>
                  ))}
                </div>
              </section>
              <section className="historical-rail-panel historical-safety-panel">
                <div className="historical-rail-heading">
                  <AlertTriangle size={20} />
                  <strong>Non-negotiables</strong>
                </div>
                <p>
                  Generated dialogue is simulation. The historian layer must mark evidence,
                  uncertainty, anachronism, and harmful views clearly.
                </p>
              </section>
            </aside>
          </section>
        ) : (
          <section className="historical-stage-grid">
            <aside className="historical-dossier-panel">
              <div className="historical-session-heading">
                <Landmark size={23} />
                <div>
                  <span>Living dossier</span>
                  <strong>{personOrTheme.trim() || topic.name}</strong>
                </div>
              </div>
              <div className="historical-session-meta">
                <span>
                  <ClockIcon /> {selectedTimeSlice}
                </span>
                <span>
                  <MapPin size={15} /> {setting.trim() || "Historically fitted setting"}
                </span>
                <span>
                  <Scale size={15} /> {selectedMode.label}
                </span>
              </div>
              <div className="historical-dossier-actions">
                {historicalDossierActions.map((action) => (
                  <button
                    key={action.title}
                    type="button"
                    disabled={sending}
                    onClick={() =>
                      void onSend(
                        buildMiniAppInstruction({
                          visible: action.title,
                          instructions: action.prompt,
                        }),
                      )
                    }
                  >
                    <strong>{action.title}</strong>
                    <span>{action.body}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={sending}
                className="historical-debrief-button"
                onClick={() =>
                  void onSend(
                    buildMiniAppInstruction({
                      visible: "Generate debrief",
                      instructions:
                        "End this session with a debrief artifact: what the person argued, what I challenged, strongest insight, weakest claim, historical context learned, open questions, recommended next encounters, and any saved quotes clearly marked as generated paraphrases unless sourced.",
                    }),
                  )
                }
              >
                <FileText size={17} />
                <span>Generate debrief</span>
              </button>
              <button type="button" onClick={onReset} className="historical-new-session">
                New audience
              </button>
            </aside>

            <section className="historical-encounter-panel">
              <header className="historical-stage-top">
                <div className="historical-scene-mark">
                  <Landmark size={24} />
                </div>
                <div>
                  <span>Audience in progress</span>
                  <h2>{personOrTheme.trim() || "Historical encounter"}</h2>
                  <p>
                    {setting.trim() || "The scene is being established by the dossier."} · {userRole || selectedMode.role}
                  </p>
                </div>
                <div className="historical-temperature">
                  <Thermometer size={17} />
                  <span>{selectedMode.label}</span>
                </div>
              </header>

              <div className="historical-mode-switcher" aria-label="Conversation controls">
                {historicalModeSwitches.map((switcher) => (
                  <button
                    key={switcher.label}
                    type="button"
                    disabled={sending}
                    onClick={() =>
                      void onSend(
                        buildMiniAppInstruction({
                          visible: switcher.label,
                          instructions: switcher.prompt,
                        }),
                      )
                    }
                  >
                    {switcher.label}
                  </button>
                ))}
              </div>

              <div className="inspir-message-stack historical-message-stack">
                {visibleMessages.map((message) => (
                  <MessageCard key={message.id} message={message} userLabel={userName} />
                ))}
                {awaitingResponse ? (
                  <ThinkingMarker label="Thinking" />
                ) : null}
              </div>
            </section>

            <aside className="historical-sidecar-panel">
              <div className="historical-session-heading">
                <ShieldCheck size={22} />
                <div>
                  <span>Historian sidecar</span>
                  <strong>{historianVisibilityOptions.find((option) => option.value === historianVisibility)?.label}</strong>
                </div>
              </div>
              <div className="historical-sidecar-list">
                <article>
                  <strong>Evidence labels</strong>
                  <span>Documented, plausible reconstruction, modern paraphrase, contested, or fictionalized.</span>
                </article>
                <article>
                  <strong>Knowledge boundary</strong>
                  <span>The person should not know future events unless you explicitly open modern confrontation.</span>
                </article>
                <article>
                  <strong>Claim tracker</strong>
                  <span>Ask to save major claims and classify their evidence strength.</span>
                </article>
                <article>
                  <strong>Pressure check</strong>
                  <span>Use the dossier to see what incentives, fears, allies, and enemies shape the reply.</span>
                </article>
              </div>
            </aside>
          </section>
        )}
      </div>
      {hasSession ? (
        <form onSubmit={onSubmit} className="inspir-composer">
          <div className="inspir-composer-inner">
            <textarea
              aria-label="Historical conversation message"
              ref={inputRef}
              value={input}
              onChange={(event) => onInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask, challenge, request evidence, or open a dossier item..."
              disabled={sending}
              className="inspir-composer-input"
              rows={1}
            />
            <button
              type={sending ? "button" : "submit"}
              onClick={sending ? onStop : undefined}
              disabled={!sending && !input.trim()}
              aria-label={sending ? "Stop response" : "Send message"}
              className="inspir-send-button"
            >
              {sending ? <Square size={18} fill="currentColor" /> : <Send size={23} />}
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}

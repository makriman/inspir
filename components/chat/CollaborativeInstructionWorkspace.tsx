"use client";

import {
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useReducer,
} from "react";
import {
  Bot,
  BrainCircuit,
  FileText,
  GitPullRequestArrow,
  HeartHandshake,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  PencilLine,
  Route,
  Sparkles,
  Timer,
  UserRound,
  Workflow,
} from "lucide-react";
import type { ChatMessage as Message } from "@/components/chat/chat-message-model";
import {
  CoachChatSession,
  type CoachChatAction,
} from "@/components/chat/CoachChatSession";
import { displayMessages } from "@/components/chat/message-display";
import { mergeStateReducer } from "@/components/chat/state-utils";
import type { Topic } from "@/components/chat/topic-model";
import { buildMiniAppInstruction } from "@/lib/ai/visible-content";

const collaborationModeOptions = [
  {
    id: "friendly_builder",
    label: "Friendly builder",
    role: "supportive peer and co-builder",
    tone: "warm, practical, momentum-focused",
    instruction: "Build momentum, make a useful first pass, and ask for decisions without overpraising.",
    icon: HeartHandshake,
  },
  {
    id: "sharp_sparring_partner",
    label: "Sharp sparring partner",
    role: "tough critic and editor",
    tone: "direct, constructive, evidence-focused",
    instruction: "Challenge weak assumptions, vague claims, and missing evidence while keeping the user as decision owner.",
    icon: BrainCircuit,
  },
  {
    id: "structured_operator",
    label: "Structured operator",
    role: "project-room operator",
    tone: "crisp, organized, completion-focused",
    instruction: "Break the work into tasks, track blockers, keep the decision log current, and push toward a concrete output.",
    icon: ListChecks,
  },
] as const;

type CollaborationModeId = (typeof collaborationModeOptions)[number]["id"];

const collaborationRoomTemplates = {
  pair_builder: {
    label: "Pair builder",
    title: "Shared draft room",
    artifactTitle: "Working artifact",
    icon: FileText,
    sections: [
      { title: "Output", body: "Define the thing we are making and the standard it has to meet." },
      { title: "Structure", body: "Sketch the outline, sections, or table before polishing language." },
      { title: "Evidence", body: "Collect examples, facts, quotes, or constraints that support the work." },
      { title: "Revision", body: "Track accepted changes, rejected changes, and the next edit." },
    ],
    comments: ["Clarify the audience", "Preserve user voice", "Show changes before merging"],
  },
  sparring_partner: {
    label: "Sparring partner",
    title: "Argument test room",
    artifactTitle: "Assumption map",
    icon: GitPullRequestArrow,
    sections: [
      { title: "Claim", body: "State the idea in one sentence so it can be tested." },
      { title: "Assumptions", body: "List what has to be true for the idea to work." },
      { title: "Weakest point", body: "Attack the most fragile assumption first." },
      { title: "Decision", body: "Accept, revise, reject, or gather evidence." },
    ],
    comments: ["Prove this", "Separate logic from execution", "Name the tradeoff"],
  },
  study_buddy: {
    label: "Study buddy",
    title: "Learning workroom",
    artifactTitle: "Concept board",
    icon: Lightbulb,
    sections: [
      { title: "Core idea", body: "Build the plain-language explanation together." },
      { title: "User explanation", body: "The learner explains it back in their own words." },
      { title: "AI challenge", body: "One targeted question tests the current understanding." },
      { title: "Recap", body: "Lock useful notes only after the idea has been used." },
    ],
    comments: ["Unclear", "Try an example", "Check understanding before moving on"],
  },
  project_operator: {
    label: "Project operator",
    title: "Execution room",
    artifactTitle: "Task board",
    icon: Workflow,
    sections: [
      { title: "Goal", body: "Define the concrete finish line and owner." },
      { title: "Next actions", body: "Split work into AI-owned, user-owned, and shared moves." },
      { title: "Blockers", body: "Expose missing input, risk, time pressure, or unclear scope." },
      { title: "Checkpoint", body: "End every sprint with an artifact or decision." },
    ],
    comments: ["Make it smaller", "Assign ownership", "End with output"],
  },
  creative_partner: {
    label: "Creative partner",
    title: "Idea studio",
    artifactTitle: "Option board",
    icon: Sparkles,
    sections: [
      { title: "Raw options", body: "Generate enough material to choose from." },
      { title: "Clusters", body: "Group similar ideas and name the pattern." },
      { title: "Kill list", body: "Remove weak, generic, or low-fit ideas quickly." },
      { title: "Prototype", body: "Develop the strongest option into something testable." },
    ],
    comments: ["Expand", "Cut", "Make it stranger", "Pick the strongest"],
  },
} as const;

type CollaborationRoomType = keyof typeof collaborationRoomTemplates;

const collaborationQuickStarts = [
  "Prepare for a class discussion on Tata's acquisition of JLR",
  "Build an essay outline on climate adaptation",
  "Pressure-test my startup idea",
  "Learn supply and demand by working through examples",
];

const collaborationHandoffActions = [
  {
    label: "AI, take first pass",
    prompt: "Take the first pass on the shared artifact. Make the structure visible, mark assumptions, and ask me to accept, edit, or reject.",
    icon: Bot,
  },
  {
    label: "I will try",
    prompt: "Hand the next move to me. Give me one clear task and wait for my contribution before you revise.",
    icon: UserRound,
  },
  {
    label: "Challenge me",
    prompt: "Challenge the weakest part of the current artifact. Be direct, name the assumption, and ask me to defend or revise it.",
    icon: BrainCircuit,
  },
  {
    label: "Rewrite this",
    prompt: "Rewrite the current rough section as a suggested edit. Show what changed and why before asking me to merge it.",
    icon: PencilLine,
  },
  {
    label: "Just advise",
    prompt: "Stop editing directly for this turn. Give concise advice and one practical next move.",
    icon: MessageSquareText,
  },
  {
    label: "Merge changes",
    prompt: "Merge the accepted changes into a clean current version, then update the decision log and open questions.",
    icon: GitPullRequestArrow,
  },
] as const;

function getCollaborationMode(modeId: CollaborationModeId) {
  return collaborationModeOptions.find((mode) => mode.id === modeId) ?? collaborationModeOptions[0];
}

function inferCollaborationRoomType(goal: string): CollaborationRoomType {
  const normalized = goal.toLowerCase();
  if (
    /\b(essay|write|draft|memo|deck|pitch|outline|paper|article|answer|story|script|proposal)\b/.test(
      normalized,
    )
  ) {
    return "pair_builder";
  }
  if (/\b(idea|argument|assumption|strategy|decision|hypothesis|risk|case|debate|thesis)\b/.test(normalized)) {
    return "sparring_partner";
  }
  if (/\b(project|execute|plan|tasks|deadline|launch|ship|finish|operator|sprint)\b/.test(normalized)) {
    return "project_operator";
  }
  if (/\b(brainstorm|creative|ideas|name|concept|options|prototype)\b/.test(normalized)) {
    return "creative_partner";
  }
  return "study_buddy";
}

function extractCollaborationGoal(messages: Message[]) {
  const firstUser = messages.find((message) => message.role === "user")?.content.trim();
  if (!firstUser) return "";
  const extracted = extractCollaborationGoalFromContent(firstUser);
  if (extracted) return extracted;
  return firstUser.length > 180 ? `${firstUser.slice(0, 177).trim()}...` : firstUser;
}

function extractCollaborationGoalFromContent(content: string) {
  const match = content.match(/collaborative workroom for:\s*([\s\S]*?)(?:\n\nMode:|$)/i);
  return match?.[1]?.trim() ?? "";
}

function buildCollaborativeInstructionPrompt({
  goal,
  mode,
  roomType,
}: {
  goal: string;
  mode: (typeof collaborationModeOptions)[number];
  roomType: CollaborationRoomType;
}) {
  const room = collaborationRoomTemplates[roomType];
  return buildMiniAppInstruction({
    visible: `Open workroom: ${goal} (${mode.label})`,
    instructions: [
      `Let's open a collaborative workroom for: ${goal}`,
      "",
      `Mode: ${mode.label}`,
      `AI role: ${mode.role}`,
      `Tone: ${mode.tone}`,
      `Workspace: ${room.label} - ${room.artifactTitle}`,
      "",
      "Make the first rough structure before giving advice. Start with: \"I made the first rough structure. Edit anything. I will react to your changes.\"",
      "Use visible sections: Shared artifact, AI contribution, User move, Inline comments, Decision log, Open questions, Next action.",
      mode.instruction,
      "Track decisions and open questions. Preserve my voice in writing tasks. Ask at most one practical question if context is missing.",
    ].join("\n"),
  });
}

function formatSprintTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function CollaborativeInstructionWorkspace({
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
  const [{ goal, roomGoal, modeId, sprintSeconds, sprintRunning }, updateCollaborationState] = useReducer(
    mergeStateReducer<{
      goal: string;
      roomGoal: string;
      modeId: CollaborationModeId;
      sprintSeconds: number;
      sprintRunning: boolean;
    }>,
    {
      goal: "",
      roomGoal: "",
      modeId: "friendly_builder",
      sprintSeconds: 10 * 60,
      sprintRunning: false,
    },
  );
  const rawMessages = messages.filter((message) => message.role !== "system");
  const visibleMessages = displayMessages(messages);
  const recoveredGoal = extractCollaborationGoal(rawMessages);
  const activeGoal = roomGoal || recoveredGoal || goal;
  const roomType = inferCollaborationRoomType(activeGoal);
  const room = collaborationRoomTemplates[roomType];
  const RoomIcon = room.icon;
  const activeMode = getCollaborationMode(modeId);
  const hasSession = rawMessages.length > 0 || sending || awaitingResponse || Boolean(roomGoal);

  useEffect(() => {
    if (!sprintRunning) return;
    const timer = window.setInterval(() => {
      updateCollaborationState((current) => {
        if (current.sprintSeconds <= 1) {
          window.clearInterval(timer);
          window.setTimeout(() => updateCollaborationState({ sprintRunning: false }), 0);
          return { sprintSeconds: 0 };
        }
        return { sprintSeconds: current.sprintSeconds - 1 };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sprintRunning]);

  function startWorkroom(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed || sending) return;
    const nextRoomType = inferCollaborationRoomType(trimmed);
    updateCollaborationState({ roomGoal: trimmed });
    void onSend(
      buildCollaborativeInstructionPrompt({
        goal: trimmed,
        mode: activeMode,
        roomType: nextRoomType,
      }),
    );
  }

  function switchMode(nextModeId: CollaborationModeId) {
    if (nextModeId === modeId || sending) return;
    const nextMode = getCollaborationMode(nextModeId);
    updateCollaborationState({ modeId: nextModeId });
    if (hasSession) {
      void onSend(
        buildMiniAppInstruction({
          visible: `Switch to ${nextMode.label}`,
          instructions: `Switch collaboration mode to ${nextMode.label}. Keep the same shared artifact, decision log, open questions, and user ownership.`,
        }),
      );
    }
  }

  function sendHandoff(action: (typeof collaborationHandoffActions)[number]) {
    if (sending) return;
    void onSend(
      buildMiniAppInstruction({
        visible: action.label,
        instructions: action.prompt,
      }),
    );
  }

  function startSprint() {
    if (sending) return;
    updateCollaborationState({ sprintSeconds: 10 * 60, sprintRunning: true });
    void onSend(
      buildMiniAppInstruction({
        visible: "Start 10-minute sprint",
        instructions: `Start a 10-minute sprint for "${activeGoal || topic.name}". Pick one concrete artifact checkpoint, assign my move and your support role, then end with a checkpoint.`,
      }),
    );
  }

  if (hasSession) {
    return (
      <CollaborativeSession
        activeGoal={activeGoal}
        activeMode={activeMode}
        awaitingResponse={awaitingResponse}
        input={input}
        inputRef={inputRef}
        listRef={listRef}
        messages={visibleMessages}
        modeId={modeId}
        room={room}
        roomIcon={RoomIcon}
        sending={sending}
        sprintRunning={sprintRunning}
        sprintSeconds={sprintSeconds}
        topic={topic}
        userName={userName}
        onHandoff={sendHandoff}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onReset={onReset}
        onSprint={startSprint}
        onStop={onStop}
        onSubmit={onSubmit}
        onSwitchMode={switchMode}
      />
    );
  }

  return (
    <CollaborativeSetup
      activeMode={activeMode}
      goal={goal}
      listRef={listRef}
      modeId={modeId}
      room={room}
      roomIcon={RoomIcon}
      sending={sending}
      onGoal={(value) => updateCollaborationState({ goal: value })}
      onMode={(value) => updateCollaborationState({ modeId: value })}
      onStartWorkroom={startWorkroom}
    />
  );
}

function CollaborativeSession({
  activeGoal,
  activeMode,
  awaitingResponse,
  input,
  inputRef,
  listRef,
  messages,
  modeId,
  room,
  roomIcon: RoomIcon,
  sending,
  sprintRunning,
  sprintSeconds,
  topic,
  userName,
  onHandoff,
  onInput,
  onKeyDown,
  onReset,
  onSprint,
  onStop,
  onSubmit,
  onSwitchMode,
}: {
  activeGoal: string;
  activeMode: (typeof collaborationModeOptions)[number];
  awaitingResponse: boolean;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  messages: Message[];
  modeId: CollaborationModeId;
  room: (typeof collaborationRoomTemplates)[CollaborationRoomType];
  roomIcon: ComponentType<{ size?: number }>;
  sending: boolean;
  sprintRunning: boolean;
  sprintSeconds: number;
  topic: Topic;
  userName: string;
  onHandoff: (action: (typeof collaborationHandoffActions)[number]) => void;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onReset: () => void;
  onSprint: () => void;
  onStop: () => void;
  onSubmit: (event?: FormEvent) => void;
  onSwitchMode: (modeId: CollaborationModeId) => void;
}) {
  const ActiveModeIcon = activeMode.icon;
  const actionItems: CoachChatAction[] = [
    ...collaborationHandoffActions.map((action) => ({
      label: action.label,
      icon: action.icon,
      disabled: sending,
      onClick: () => onHandoff(action),
    })),
    {
      label: sprintRunning ? "Sprint running" : "Start 10 min",
      icon: Timer,
      disabled: sending || sprintRunning,
      onClick: onSprint,
    },
    ...collaborationModeOptions.map((modeOption) => ({
      label: modeOption.label,
      icon: modeOption.icon,
      disabled: sending || modeOption.id === modeId,
      onClick: () => onSwitchMode(modeOption.id),
    })),
  ];

  return (
    <CoachChatSession
      eyebrow="Collaborative Instruction"
      title={activeGoal || topic.name}
      subtitle={`${room.title} - ${activeMode.label}`}
      userName={userName}
      coachName="Collaborator"
      placeholder="Add, edit, challenge, or decide the next move"
      messages={messages}
      input={input}
      sending={sending}
      awaitingResponse={awaitingResponse}
      inputRef={inputRef}
      listRef={listRef}
      actions={actionItems}
      details={[
        { title: "Workspace", body: `${room.label} - ${room.artifactTitle}`, icon: RoomIcon },
        { title: "Working style", body: `${activeMode.role}. ${activeMode.tone}.`, icon: ActiveModeIcon },
        {
          title: "Sprint clock",
          body: sprintRunning ? `${formatSprintTime(sprintSeconds)} remaining` : "Ready for a 10-minute checkpoint",
          icon: Timer,
        },
        ...room.sections.map((section) => ({ title: section.title, body: section.body, icon: FileText })),
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

function CollaborativeSetup({
  activeMode,
  goal,
  listRef,
  modeId,
  room,
  roomIcon: RoomIcon,
  sending,
  onGoal,
  onMode,
  onStartWorkroom,
}: {
  activeMode: (typeof collaborationModeOptions)[number];
  goal: string;
  listRef: RefObject<HTMLDivElement | null>;
  modeId: CollaborationModeId;
  room: (typeof collaborationRoomTemplates)[CollaborationRoomType];
  roomIcon: ComponentType<{ size?: number }>;
  sending: boolean;
  onGoal: (value: string) => void;
  onMode: (value: CollaborationModeId) => void;
  onStartWorkroom: (event?: FormEvent) => void;
}) {
  const ActiveModeIcon = activeMode.icon;
  return (
    <main className="inspir-workspace inspir-collab-workspace">
      <div ref={listRef} className="inspir-collab-scroll app-scrollbar">
        <section className="inspir-collab-start">
          <header className="inspir-collab-roombar">
            <div>
              <span>Shared workroom</span>
              <h2>Collaborative Instruction</h2>
            </div>
            <strong className="inspir-collab-status-pill">
              <ActiveModeIcon size={15} />
              Mode: {activeMode.label}
            </strong>
          </header>
          <div className="inspir-collab-start-grid">
            <form className="inspir-collab-intent-panel" onSubmit={onStartWorkroom}>
              <label htmlFor="collab-goal">What are we trying to build, solve, learn, or improve?</label>
              <textarea
                id="collab-goal"
                value={goal}
                onChange={(event) => onGoal(event.target.value)}
                placeholder="Prepare for a class discussion on Tata's acquisition of JLR"
                rows={5}
                disabled={sending}
              />
              <fieldset className="inspir-collab-mode-picker">
                <legend className="sr-only">Collaboration style</legend>
                {collaborationModeOptions.map((modeOption) => {
                  const ModeIcon = modeOption.icon;
                  return (
                    <button
                      key={modeOption.id}
                      type="button"
                      onClick={() => onMode(modeOption.id)}
                      className={modeOption.id === modeId ? "is-active" : ""}
                    >
                      <ModeIcon size={17} />
                      <span>{modeOption.label}</span>
                    </button>
                  );
                })}
              </fieldset>
              <button type="submit" disabled={!goal.trim() || sending} className="inspir-collab-open-button">
                <Route size={18} />
                Open workroom
              </button>
            </form>
            <section className="inspir-collab-canvas-preview" aria-label="Workspace preview">
              <div className="inspir-collab-preview-head">
                <RoomIcon size={22} />
                <div>
                  <span>{room.title}</span>
                  <strong>{room.artifactTitle}</strong>
                </div>
              </div>
              <div className="inspir-collab-preview-grid">
                {room.sections.map((section) => (
                  <article key={section.title}>
                    <strong>{section.title}</strong>
                    <span>{section.body}</span>
                  </article>
                ))}
              </div>
              <div className="inspir-collab-quick-starts">
                {collaborationQuickStarts.map((quickStart) => (
                  <button key={quickStart} type="button" onClick={() => onGoal(quickStart)}>
                    <Sparkles size={14} />
                    <span>{quickStart}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

"use client";

import { FormEvent, useState } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  Gauge,
  MessageCircle,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";

type TopicLike = {
  name: string;
};

type SetupStage = "goal" | "context";
type Difficulty = "easier" | "same" | "harder" | "exam" | "real-world";
type Domain = "finance" | "economics" | "strategy" | "coding" | "writing" | "general";
type BlockType = "choice" | "concept" | "simulation" | "open-response" | "mastery";

type LessonProfile = {
  goal: string;
  context: string;
  level: string;
  mode: Difficulty;
};

type LessonChoice = {
  label: string;
  correct?: boolean;
  feedback: string;
  misconception?: string;
};

type LessonBlock = {
  type: BlockType;
  skill: string;
  prompt: string;
  explanation: string;
  example: string;
  nonExample: string;
  commonMistake: string;
  whyItMatters: string;
  actionLabel: string;
  hint: string;
  repair: string;
  choices?: LessonChoice[];
  expectedTerms?: string[];
};

type LessonStep = {
  id: string;
  title: string;
  summary: string;
  checkpoint: string;
  block: LessonBlock;
};

type Lesson = {
  objective: string;
  domain: Domain;
  estimatedEffort: string;
  steps: LessonStep[];
};

type Feedback = {
  tone: "success" | "repair";
  title: string;
  body: string;
  repair?: string;
};

type CoachEntry = {
  id: string;
  role: "learner" | "coach";
  content: string;
};

const goalExamples = [
  "Teach me financial modeling",
  "Help me understand supply and demand",
  "Teach me Porter's Five Forces",
  "Help me debug JavaScript promises",
];

const contextOptions = ["Exam", "Work", "Project", "Curiosity"];
const levelOptions = ["Beginner", "Shaky", "Decent", "Advanced"];

const difficultyOptions: Array<{ id: Difficulty; label: string }> = [
  { id: "easier", label: "Easier" },
  { id: "same", label: "Same level" },
  { id: "harder", label: "Harder" },
  { id: "exam", label: "Exam mode" },
  { id: "real-world", label: "Real-world mode" },
];

function inferDomain(goal: string): Domain {
  const normalized = goal.toLowerCase();
  if (/(finance|valuation|cash flow|dcf|model|statement|revenue|margin)/.test(normalized)) return "finance";
  if (/(economics|supply|demand|elasticity|tax|market|inflation)/.test(normalized)) return "economics";
  if (/(strategy|porter|forces|competitor|industry|moat|market entry)/.test(normalized)) return "strategy";
  if (/(code|coding|javascript|python|react|debug|programming|function|api)/.test(normalized)) return "coding";
  if (/(write|writing|essay|argument|thesis|paragraph|tone|revision)/.test(normalized)) return "writing";
  return "general";
}

function domainCopy(domain: Domain) {
  const copy = {
    finance: {
      skill: "connect assumptions, cash flow, and valuation",
      concept:
        "A useful model is a chain: assumptions drive operations, operations create cash flow, and cash flow becomes value only after timing and risk are considered.",
      example:
        "If price rises while volume stays steady, revenue can increase. If costs rise faster, free cash flow may still fall.",
      nonExample:
        "Saying revenue is up, so the company is worth more ignores margins, reinvestment, working capital, and risk.",
      mistake: "Confusing accounting profit with cash that can actually be distributed or reinvested.",
      why: "This lets you explain why a model moves instead of just copying formulas.",
      diagnosticPrompt:
        "Try first: if sales grow 20% but margins shrink and inventory needs jump, what probably happens to free cash flow?",
      choices: [
        {
          label: "It definitely rises because sales are higher.",
          feedback:
            "That catches the revenue movement, but misses the margin and cash timing links. Sales alone do not prove cash flow improved.",
          misconception: "Treats revenue growth as value growth.",
        },
        {
          label: "It may fall because costs and working capital can absorb the sales gain.",
          correct: true,
          feedback:
            "Yes. You connected sales, margins, and working capital instead of treating one line as the whole model.",
        },
        {
          label: "It is impossible to know anything until terminal value is calculated.",
          feedback:
            "Terminal value matters later, but the operating cash flow direction is already testable from the assumptions.",
          misconception: "Jumps to valuation before reading the operating model.",
        },
      ],
      terms: ["cash", "margin", "working capital", "risk"],
      challenge:
        "In 4 sentences, explain how one assumption change moves revenue, cash flow, and value. Name one thing you would check before trusting it.",
      formula: "Value = forecast free cash flows discounted for risk + discounted terminal value.",
    },
    economics: {
      skill: "predict market movement from incentives",
      concept:
        "Markets move when incentives change. Demand captures willingness to buy, supply captures willingness to sell, and price is where the pressure balances.",
      example:
        "If production costs rise, sellers need a higher price to supply the same quantity, so the supply curve shifts left.",
      nonExample:
        "A price change alone is movement along a curve, not automatically a shift of the whole curve.",
      mistake: "Calling every price movement a demand shift.",
      why: "It helps you predict policy, taxes, shortages, and market reactions without memorizing diagrams.",
      diagnosticPrompt:
        "Try first: a coffee tax raises sellers' cost. What should you expect before seeing the graph?",
      choices: [
        {
          label: "Supply shifts left and price tends to rise.",
          correct: true,
          feedback: "Right. You identified a seller-side cost shock and predicted the pressure on price.",
        },
        {
          label: "Demand shifts right because coffee is more expensive.",
          feedback:
            "Higher price does not mean demand increased. The tax starts on the supply side by changing seller costs.",
          misconception: "Confuses movement along demand with a demand shift.",
        },
        {
          label: "Nothing changes unless buyers' tastes change.",
          feedback: "Buyer tastes are only one driver. Costs, technology, taxes, and input prices can move supply.",
          misconception: "Ignores supply-side causes.",
        },
      ],
      terms: ["supply", "demand", "price", "quantity"],
      challenge:
        "Explain a market change by naming the curve that moves, the reason it moves, and what happens to price and quantity.",
      formula: "Equilibrium changes when supply or demand shifts; elasticity decides who bears more of the burden.",
    },
    strategy: {
      skill: "diagnose industry attractiveness from forces",
      concept:
        "A strategy framework is a pressure test. Porter's Five Forces asks who can take profit away and how strong each pressure is.",
      example:
        "Food delivery can have intense rivalry, powerful customers, and easy switching, which squeezes profit even when demand is high.",
      nonExample:
        "Listing the five labels without judging their strength does not explain whether the industry is attractive.",
      mistake: "Treating a popular market as an attractive market.",
      why: "It helps you explain profit potential, not just market size.",
      diagnosticPrompt:
        "Try first: in food delivery, which force is most likely strengthened by customers comparing prices across apps?",
      choices: [
        {
          label: "Buyer power",
          correct: true,
          feedback: "Exactly. Easy comparison and switching give customers leverage over platforms.",
        },
        {
          label: "Supplier power",
          feedback:
            "Restaurants and drivers can be suppliers, but this specific clue is about customers comparing and switching.",
          misconception: "Classifies actors before reading the behavior.",
        },
        {
          label: "Threat of substitutes",
          feedback:
            "Substitutes are alternatives like cooking or pickup. Comparing apps is buyer leverage inside the category.",
          misconception: "Mixes substitutes with direct alternatives.",
        },
      ],
      terms: ["rivalry", "buyers", "suppliers", "substitutes", "entry"],
      challenge:
        "Diagnose one industry in 5 sentences: identify two strongest forces, explain why, and judge whether profits look protected.",
      formula: "Attractiveness rises when customers, suppliers, rivals, entrants, and substitutes have limited power.",
    },
    coding: {
      skill: "trace cause and effect in code",
      concept:
        "Debugging is not guessing. You form a hypothesis, inspect the smallest failing path, then change one variable at a time.",
      example:
        "If an async function returns before data arrives, trace the promise chain and check where await is missing.",
      nonExample: "Changing several files at once may hide the actual cause even if the symptom disappears.",
      mistake: "Fixing the visible error message without tracing the state that produced it.",
      why: "It makes you faster because each test either proves or removes a hypothesis.",
      diagnosticPrompt:
        "Try first: a value logs as undefined right after a fetch call. What is the most useful first check?",
      choices: [
        {
          label: "Check whether the async result is awaited before reading it.",
          correct: true,
          feedback: "Good. You tested timing before rewriting the data model.",
        },
        {
          label: "Rename the variable everywhere.",
          feedback: "A bad name can confuse, but the clue points to timing. First prove whether the data has arrived.",
          misconception: "Changes syntax before checking execution order.",
        },
        {
          label: "Delete the fetch and hard-code the answer.",
          feedback: "That may hide the symptom, but it does not teach you where the data flow broke.",
          misconception: "Removes the failing path instead of understanding it.",
        },
      ],
      terms: ["state", "input", "output", "hypothesis", "trace"],
      challenge:
        "Explain a debugging plan: state the symptom, your first hypothesis, the smallest test, and what each result would mean.",
      formula: "Bug fix loop = reproduce, isolate, hypothesize, test one change, verify.",
    },
    writing: {
      skill: "turn claims into clear arguments",
      concept:
        "Strong writing is a chain of claim, reason, evidence, and consequence. Each sentence should do a job in that chain.",
      example:
        "A strong paragraph names the claim, proves it with evidence, then explains why the evidence changes the reader's view.",
      nonExample: "A paragraph that lists facts without a claim makes the reader do the argument work.",
      mistake: "Adding more information when the real gap is the link between evidence and claim.",
      why: "It lets you revise for logic, not just polish wording.",
      diagnosticPrompt:
        "Try first: which sentence usually needs repair when evidence is present but the paragraph still feels unconvincing?",
      choices: [
        {
          label: "The explanation that links evidence back to the claim.",
          correct: true,
          feedback: "Yes. Evidence needs interpretation or the argument feels unfinished.",
        },
        {
          label: "The title, because every weak paragraph has a weak title.",
          feedback: "Titles matter, but this clue points to reasoning inside the paragraph.",
          misconception: "Optimizes presentation before argument logic.",
        },
        {
          label: "The longest sentence, because shorter is always stronger.",
          feedback: "Concision helps only after the argument works. Length is not the main diagnosis here.",
          misconception: "Treats style as a substitute for reasoning.",
        },
      ],
      terms: ["claim", "evidence", "reason", "reader"],
      challenge: "Write a 4 sentence paragraph with a claim, evidence, explanation, and consequence.",
      formula: "Argument paragraph = claim + evidence + reasoning + consequence.",
    },
    general: {
      skill: "build a usable mental model",
      concept:
        "Understanding means you can predict, explain, and use an idea in a new situation. Reading is only the start.",
      example:
        "If you understand a concept, you can give an example, a non-example, and solve a small unfamiliar case.",
      nonExample: "Repeating a definition without applying it can feel fluent while hiding gaps.",
      mistake: "Moving on after recognition instead of testing recall and transfer.",
      why: "It turns a topic from something you have seen into something you can use.",
      diagnosticPrompt: "Try first: what is better evidence that you understand a new concept?",
      choices: [
        {
          label: "You can recognize the definition when it appears.",
          feedback:
            "Recognition is useful, but it is weaker evidence than applying the idea without the answer in front of you.",
          misconception: "Equates familiarity with ability.",
        },
        {
          label: "You can use it correctly in a new example.",
          correct: true,
          feedback: "Right. Transfer to a fresh example is stronger evidence than recognition.",
        },
        {
          label: "You read three explanations about it.",
          feedback: "Multiple explanations can help, but the proof is what you can do after reading.",
          misconception: "Equates content consumption with learning.",
        },
      ],
      terms: ["predict", "example", "explain", "apply"],
      challenge:
        "Explain the idea in your own words, give one example, give one non-example, and apply it to a new case.",
      formula: "Mastery = recall + application + feedback + transfer.",
    },
  } satisfies Record<
    Domain,
    {
      skill: string;
      concept: string;
      example: string;
      nonExample: string;
      mistake: string;
      why: string;
      diagnosticPrompt: string;
      choices: LessonChoice[];
      terms: string[];
      challenge: string;
      formula: string;
    }
  >;

  return copy[domain];
}

function buildLesson(profile: LessonProfile): Lesson {
  const domain = inferDomain(profile.goal);
  const copy = domainCopy(domain);
  const contextPhrase = profile.context ? ` in a ${profile.context.toLowerCase()} context` : "";

  return {
    objective: `Become able to ${copy.skill} for ${profile.goal}`,
    domain,
    estimatedEffort: profile.mode === "exam" ? "8-12 min" : "10-15 min",
    steps: [
      {
        id: "diagnose",
        title: "Try first",
        summary: "Reveal the starting model before the lesson explains it.",
        checkpoint: "The learner can make a first prediction.",
        block: {
          type: "choice",
          skill: copy.skill,
          prompt: copy.diagnosticPrompt,
          explanation: `We will train this${contextPhrase} by testing your current instinct first.`,
          example: copy.example,
          nonExample: copy.nonExample,
          commonMistake: copy.mistake,
          whyItMatters: copy.why,
          actionLabel: "Check my prediction",
          hint: "Look for the causal link. Which variable actually changed, and what does it affect next?",
          repair: `Use this contrast: ${copy.nonExample} The stronger model is: ${copy.concept}`,
          choices: copy.choices,
        },
      },
      {
        id: "model",
        title: "Core model",
        summary: "Compress the idea into one usable mental model.",
        checkpoint: "The learner can explain the key link in their own words.",
        block: {
          type: "concept",
          skill: copy.skill,
          prompt: "Write the core link in one sentence before moving on.",
          explanation: copy.concept,
          example: copy.example,
          nonExample: copy.nonExample,
          commonMistake: copy.mistake,
          whyItMatters: copy.why,
          actionLabel: "Submit my sentence",
          hint: `Use at least one of these words: ${copy.terms.slice(0, 3).join(", ")}.`,
          repair: 'Try this frame: "When ___ changes, ___ changes because ___."',
          expectedTerms: copy.terms,
        },
      },
      {
        id: "manipulate",
        title: "Manipulate",
        summary: "Change inputs and explain the output.",
        checkpoint: "The learner can connect a variable change to an outcome.",
        block: {
          type: "simulation",
          skill: copy.skill,
          prompt: "Move one control, watch the result, then explain why the output changed.",
          explanation: "A simulation makes the hidden causal chain visible. Change one thing at a time.",
          example: copy.example,
          nonExample: "Moving every control at once makes it hard to know what caused the result.",
          commonMistake: "Seeing the output change but not naming the mechanism.",
          whyItMatters: "Manipulation proves you can use the model, not just repeat it.",
          actionLabel: "Explain the change",
          hint: "Name the input you changed, the immediate effect, and the final result.",
          repair: "Reset the controls, move only one slider, and describe the before-and-after in plain language.",
          expectedTerms: copy.terms,
        },
      },
      {
        id: "repair",
        title: "Common mistake",
        summary: "Contrast the tempting wrong model with the correct one.",
        checkpoint: "The learner can identify and fix the misconception.",
        block: {
          type: "open-response",
          skill: copy.skill,
          prompt: `Repair this mistake: ${copy.mistake}`,
          explanation: `The tempting shortcut is incomplete. The better model is: ${copy.concept}`,
          example: copy.example,
          nonExample: copy.nonExample,
          commonMistake: copy.mistake,
          whyItMatters: "Repairing the misconception makes the next problem easier instead of just more familiar.",
          actionLabel: "Submit repair",
          hint: "Say why the mistake is tempting, then name the missing link.",
          repair: `Contrast pair: tempting version: ${copy.nonExample} Stronger version: ${copy.example}`,
          expectedTerms: copy.terms,
        },
      },
      {
        id: "mastery",
        title: "Prove it",
        summary: "Apply the idea to a new situation without being carried.",
        checkpoint: "The learner demonstrates transfer.",
        block: {
          type: "mastery",
          skill: copy.skill,
          prompt: copy.challenge,
          explanation: "This is the evidence checkpoint. You advance only by showing the skill.",
          example: copy.example,
          nonExample: copy.nonExample,
          commonMistake: copy.mistake,
          whyItMatters: "A final transfer task proves improvement better than a Next button.",
          actionLabel: "Evaluate mastery",
          hint: `Rubric: name the concept, apply it, justify it, and avoid this mistake: ${copy.mistake}`,
          repair: "If the transfer feels hard, return to the contrast pair and write a smaller version first.",
          expectedTerms: copy.terms,
        },
      },
    ],
  };
}

function simulationLabelsFor(domain: Domain) {
  if (domain === "finance") {
    return {
      a: "Price",
      b: "Volume",
      c: "Margin",
      d: "Working capital drag",
      output: "Estimated value",
      unit: "$",
    };
  }
  if (domain === "economics") {
    return {
      a: "Demand pressure",
      b: "Supply capacity",
      c: "Elasticity",
      d: "Tax or friction",
      output: "Market pressure score",
      unit: "",
    };
  }
  if (domain === "strategy") {
    return {
      a: "Buyer power",
      b: "Rivalry",
      c: "Entry barriers",
      d: "Substitute threat",
      output: "Profit protection",
      unit: "",
    };
  }
  if (domain === "coding") {
    return {
      a: "Inputs checked",
      b: "Trace depth",
      c: "Hypothesis clarity",
      d: "Changes at once",
      output: "Debug confidence",
      unit: "",
    };
  }
  if (domain === "writing") {
    return {
      a: "Claim clarity",
      b: "Evidence strength",
      c: "Reasoning link",
      d: "Extra clutter",
      output: "Argument strength",
      unit: "",
    };
  }
  return {
    a: "Examples",
    b: "Practice",
    c: "Feedback",
    d: "Cognitive load",
    output: "Mastery signal",
    unit: "",
  };
}

function scoreOpenResponse(answer: string, expectedTerms: string[] | undefined) {
  const normalized = answer.toLowerCase();
  const terms = expectedTerms ?? [];
  const matchedTerms = terms.filter((term) => normalized.includes(term.toLowerCase()));
  const hasBecause = /\bbecause\b|\bso\b|\btherefore\b|\bmeans\b/.test(normalized);
  const enoughLength = normalized.trim().split(/\s+/).filter(Boolean).length >= 10;
  return {
    passed: enoughLength && (matchedTerms.length >= Math.min(2, terms.length) || hasBecause),
    missingTerms: terms.filter((term) => !matchedTerms.includes(term)).slice(0, 3),
  };
}

export function InteractiveInstructionWorkspace({
  topic,
  onReset,
}: {
  topic: TopicLike;
  onReset: () => void | Promise<void>;
}) {
  const [setupStage, setSetupStage] = useState<SetupStage>("goal");
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("Project");
  const [level, setLevel] = useState("Shaky");
  const [mode, setMode] = useState<Difficulty>("same");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [mastery, setMastery] = useState(34);
  const [answer, setAnswer] = useState("");
  const [selectedChoice, setSelectedChoice] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [strengths, setStrengths] = useState<string[]>([]);
  const [misconceptions, setMisconceptions] = useState<string[]>([]);
  const [savedNotes, setSavedNotes] = useState<string[]>([]);
  const [coachInput, setCoachInput] = useState("");
  const [coachEntries, setCoachEntries] = useState<CoachEntry[]>([
    {
      id: "coach-welcome",
      role: "coach",
      content: "I will keep the lesson active: hint, repair, slow down, or raise the challenge when you ask.",
    },
  ]);
  const [simulation, setSimulation] = useState({ a: 60, b: 55, c: 42, d: 24 });

  const currentStep = lesson?.steps[currentStepIndex];
  const allComplete = Boolean(lesson && completedSteps.length === lesson.steps.length);
  const activeCopy = lesson ? domainCopy(lesson.domain) : null;
  const simulationLabels = lesson ? simulationLabelsFor(lesson.domain) : simulationLabelsFor("general");
  const simulationOutput = Math.max(
    0,
    Math.round((simulation.a * 0.9 + simulation.b * 0.85 + simulation.c * 1.15 - simulation.d * 0.95) * 2.1),
  );

  function continueSetup(event?: FormEvent) {
    event?.preventDefault();
    if (!goal.trim()) return;
    setSetupStage("context");
  }

  function startLesson(event?: FormEvent) {
    event?.preventDefault();
    if (!goal.trim()) return;
    const nextLesson = buildLesson({
      goal: goal.trim(),
      context,
      level,
      mode,
    });
    setLesson(nextLesson);
    setCurrentStepIndex(0);
    setCompletedSteps([]);
    setMastery(level === "Advanced" ? 48 : level === "Decent" ? 40 : 34);
    setAnswer("");
    setSelectedChoice("");
    setFeedback(null);
    setStrengths([]);
    setMisconceptions([]);
    setSavedNotes([]);
    setCoachEntries([
      {
        id: "coach-route",
        role: "coach",
        content: `Route built for "${goal.trim()}". We will start with action, then repair the exact gap before moving on.`,
      },
    ]);
  }

  function evaluateCurrentStep(event?: FormEvent) {
    event?.preventDefault();
    if (!currentStep) return;

    if (currentStep.block.type === "choice") {
      const choice = currentStep.block.choices?.find((item) => item.label === selectedChoice);
      if (!choice) return;
      if (choice.correct) {
        setFeedback({
          tone: "success",
          title: "Evidence accepted",
          body: choice.feedback,
        });
        setStrengths((current) => [...new Set([...current, currentStep.block.skill])].slice(-4));
        setMastery((current) => Math.min(96, current + 13));
      } else {
        setFeedback({
          tone: "repair",
          title: "Specific repair",
          body: choice.feedback,
          repair: currentStep.block.repair,
        });
        if (choice.misconception) {
          setMisconceptions((current) => [...new Set([...current, choice.misconception!])].slice(-4));
        }
        setMastery((current) => Math.max(18, current + 2));
      }
      return;
    }

    const scored = scoreOpenResponse(answer, currentStep.block.expectedTerms);
    if (scored.passed) {
      setFeedback({
        tone: "success",
        title: currentStep.block.type === "mastery" ? "Mastery evidence found" : "Good link",
        body:
          currentStep.block.type === "simulation"
            ? "You named a changed input and connected it to the result. That is the move we are training."
            : "You gave enough of the causal link to move forward.",
      });
      setStrengths((current) => [...new Set([...current, currentStep.checkpoint])].slice(-4));
      setMastery((current) => Math.min(100, current + (currentStep.block.type === "mastery" ? 18 : 12)));
    } else {
      const missing = scored.missingTerms;
      setFeedback({
        tone: "repair",
        title: "Close, but one link is missing",
        body:
          missing.length > 0
            ? `Your answer needs a clearer link using ideas like ${missing.join(", ")}.`
            : "Your answer needs a clearer because-link: what changed, what it affected, and why.",
        repair: currentStep.block.repair,
      });
      setMisconceptions((current) => [...new Set([...current, currentStep.block.commonMistake])].slice(-4));
      setMastery((current) => Math.max(18, current + 2));
    }
  }

  function advanceStep() {
    if (!lesson || !currentStep || feedback?.tone !== "success") return;
    setCompletedSteps((current) => [...new Set([...current, currentStep.id])]);
    setAnswer("");
    setSelectedChoice("");
    setFeedback(null);
    if (currentStepIndex < lesson.steps.length - 1) {
      setCurrentStepIndex((current) => current + 1);
    }
  }

  function retryStep() {
    setAnswer("");
    setSelectedChoice("");
    setFeedback(null);
  }

  function restartLesson() {
    setLesson(null);
    setSetupStage("goal");
    setGoal("");
    setContext("Project");
    setLevel("Shaky");
    setMode("same");
    void onReset();
  }

  function addCoachEntry(content: string, role: CoachEntry["role"] = "coach") {
    setCoachEntries((current) => [
      ...current,
      {
        id: `${role}-${Date.now()}-${current.length}`,
        role,
        content,
      },
    ]);
  }

  function coach(action: string) {
    if (!currentStep || !activeCopy) return;
    const replies: Record<string, string> = {
      hint: currentStep.block.hint,
      easier: `I will make the next attempt smaller. Focus only on this link: ${currentStep.block.repair}`,
      harder: "Harder mode: after you answer, add a counterexample or a boundary where the idea stops working.",
      quiz: currentStep.block.prompt,
      formula: activeCopy.formula,
      real: `Real-life connection: ${currentStep.block.whyItMatters}`,
      notes: `Saved note: ${currentStep.block.explanation}`,
      skip:
        feedback?.tone === "success"
          ? "You have evidence for this step. Use Continue to move ahead."
          : "I can compress the explanation, but I still need one proof of understanding before unlocking the next step.",
    };
    if (action === "notes") {
      setSavedNotes((current) => [...current, currentStep.block.explanation].slice(-5));
    }
    if (action === "easier") setMode("easier");
    if (action === "harder") setMode("harder");
    addCoachEntry(replies[action] ?? currentStep.block.hint);
  }

  function submitCoachQuestion(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = coachInput.trim();
    if (!trimmed || !currentStep) return;
    addCoachEntry(trimmed, "learner");
    setCoachInput("");
    const normalized = trimmed.toLowerCase();
    if (/hint|stuck|help/.test(normalized)) coach("hint");
    else if (/example/.test(normalized)) addCoachEntry(currentStep.block.example);
    else if (/formula|rule/.test(normalized)) coach("formula");
    else if (/real|case|use/.test(normalized)) coach("real");
    else {
      addCoachEntry(
        `Coach move: answer the current task first, then I will react to the exact gap. Tiny nudge: ${currentStep.block.hint}`,
      );
    }
  }

  if (!lesson) {
    return (
      <main className="bubble-workspace instruction-workspace">
        <section className="instruction-setup">
          <div className="instruction-setup-copy">
            <span>{topic.name}</span>
            <h2>Build the lesson around what you want to become able to do.</h2>
            <p>
              No long intake form. Answer one sharp question, then the app creates a route with checks,
              repair loops, and a mastery proof.
            </p>
          </div>

          {setupStage === "goal" ? (
            <form className="instruction-setup-panel" onSubmit={continueSetup}>
              <div className="instruction-panel-kicker">
                <BookOpenCheck size={22} />
                <span>Question 1 of 2</span>
              </div>
              <label>
                <span>What do you want to understand or be able to do?</span>
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder="Teach me financial modeling"
                  rows={4}
                />
              </label>
              <div className="instruction-chip-grid">
                {goalExamples.map((example) => (
                  <button key={example} type="button" onClick={() => setGoal(example)}>
                    <Sparkles size={15} />
                    <span>{example}</span>
                  </button>
                ))}
              </div>
              <button type="submit" disabled={!goal.trim()} className="instruction-primary-action">
                Shape the route
              </button>
            </form>
          ) : (
            <form className="instruction-setup-panel" onSubmit={startLesson}>
              <div className="instruction-panel-kicker">
                <Gauge size={22} />
                <span>Question 2 of 2</span>
              </div>
              <fieldset>
                <legend>What is this for?</legend>
                <div className="instruction-segment-row">
                  {contextOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={context === option ? "is-selected" : ""}
                      onClick={() => setContext(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>How strong are you right now?</legend>
                <div className="instruction-segment-row">
                  {levelOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={level === option ? "is-selected" : ""}
                      onClick={() => setLevel(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Default lesson pressure</legend>
                <div className="instruction-segment-row">
                  {difficultyOptions.slice(0, 3).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={mode === option.id ? "is-selected" : ""}
                      onClick={() => setMode(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <button type="submit" className="instruction-primary-action">
                Generate learning map
              </button>
              <button type="button" className="instruction-secondary-action" onClick={() => setSetupStage("goal")}>
                Edit goal
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  if (allComplete) {
    return (
      <main className="bubble-workspace instruction-workspace">
        <section className="instruction-complete">
          <div className="instruction-complete-badge">
            <CheckCircle2 size={38} />
            <span>Mastery checkpoint passed</span>
          </div>
          <h2>{lesson.objective}</h2>
          <p>
            Mastery score: {mastery}%. You earned the Applied badge because you used the idea in a
            fresh task instead of only reading about it.
          </p>
          <div className="instruction-recap-grid">
            <article>
              <strong>Strengths</strong>
              <span>{strengths.length ? strengths.join("; ") : "You completed the route."}</span>
            </article>
            <article>
              <strong>Repaired gaps</strong>
              <span>{misconceptions.length ? misconceptions.join("; ") : "No major misconception persisted."}</span>
            </article>
            <article>
              <strong>Saved notes</strong>
              <span>{savedNotes.length ? `${savedNotes.length} note saved` : "No notes saved yet."}</span>
            </article>
          </div>
          <button type="button" onClick={restartLesson} className="instruction-primary-action">
            Start another lesson
          </button>
        </section>
      </main>
    );
  }

  if (!currentStep) return null;

  return (
    <main className="bubble-workspace instruction-workspace">
      <section className="instruction-shell">
        <aside className="instruction-map" aria-label="Learning map">
          <div className="instruction-map-head">
            <span>Learning map</span>
            <strong>{lesson.objective}</strong>
          </div>
          <div className="instruction-mastery">
            <div>
              <span>Mastery</span>
              <strong>{mastery}%</strong>
            </div>
            <div className="instruction-mastery-track">
              <span style={{ width: `${mastery}%` }} />
            </div>
            <small>{lesson.estimatedEffort} remaining effort</small>
          </div>
          <ol className="instruction-step-list">
            {lesson.steps.map((step, index) => {
              const completed = completedSteps.includes(step.id);
              const current = index === currentStepIndex;
              const locked = index > currentStepIndex && !completed;
              return (
                <li
                  key={step.id}
                  className={`${completed ? "is-complete" : ""} ${current ? "is-current" : ""} ${
                    locked ? "is-locked" : ""
                  }`}
                >
                  <span>{completed ? <CheckCircle2 size={15} /> : index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    {current ? <p>{step.summary}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className="instruction-stage">
          <header className="instruction-stage-head">
            <div>
              <span>{currentStep.block.type.replace("-", " ")}</span>
              <h2>{currentStep.title}</h2>
              <p>{currentStep.block.skill}</p>
            </div>
            <div className="instruction-difficulty">
              {difficultyOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={mode === option.id ? "is-selected" : ""}
                  onClick={() => setMode(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </header>

          <form className="instruction-block" onSubmit={evaluateCurrentStep}>
            <ConceptSlice step={currentStep} />

            {currentStep.block.type === "choice" ? (
              <div className="instruction-choice-list" role="radiogroup" aria-label={currentStep.block.prompt}>
                {currentStep.block.choices?.map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    className={selectedChoice === choice.label ? "is-selected" : ""}
                    onClick={() => setSelectedChoice(choice.label)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            ) : null}

            {currentStep.block.type === "simulation" ? (
              <div className="instruction-simulation">
                <div className="instruction-sim-output">
                  <span>{simulationLabels.output}</span>
                  <strong>
                    {simulationLabels.unit}
                    {simulationOutput}
                  </strong>
                </div>
                <SimulationSlider
                  label={simulationLabels.a}
                  value={simulation.a}
                  onChange={(value) => setSimulation((current) => ({ ...current, a: value }))}
                />
                <SimulationSlider
                  label={simulationLabels.b}
                  value={simulation.b}
                  onChange={(value) => setSimulation((current) => ({ ...current, b: value }))}
                />
                <SimulationSlider
                  label={simulationLabels.c}
                  value={simulation.c}
                  onChange={(value) => setSimulation((current) => ({ ...current, c: value }))}
                />
                <SimulationSlider
                  label={simulationLabels.d}
                  value={simulation.d}
                  onChange={(value) => setSimulation((current) => ({ ...current, d: value }))}
                />
              </div>
            ) : null}

            {currentStep.block.type !== "choice" ? (
              <label className="instruction-answer">
                <span>{currentStep.block.prompt}</span>
                <textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Write a short answer. The app checks the link, not polish."
                  rows={currentStep.block.type === "mastery" ? 6 : 4}
                />
              </label>
            ) : null}

            {feedback ? <InstructionFeedbackCard feedback={feedback} /> : null}

            <div className="instruction-block-actions">
              {feedback?.tone === "success" ? (
                <button type="button" onClick={advanceStep} className="instruction-primary-action">
                  {currentStepIndex === lesson.steps.length - 1 ? "Finish and recap" : "Continue"}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={currentStep.block.type === "choice" ? !selectedChoice : answer.trim().length < 4}
                  className="instruction-primary-action"
                >
                  {currentStep.block.actionLabel}
                </button>
              )}
              {feedback ? (
                <button type="button" onClick={retryStep} className="instruction-secondary-action">
                  Retry this block
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <aside className="instruction-coach" aria-label="Coach sidecar">
          <div className="instruction-coach-head">
            <MessageCircle size={20} />
            <div>
              <span>Coach sidecar</span>
              <strong>Learner model</strong>
            </div>
          </div>
          <div className="instruction-model-card">
            <span>Current objective</span>
            <strong>{currentStep.checkpoint}</strong>
            <p>
              {misconceptions.length
                ? `Watching for: ${misconceptions[misconceptions.length - 1]}`
                : "No persistent misconception yet."}
            </p>
          </div>
          <div className="instruction-coach-actions">
            <button type="button" onClick={() => coach("hint")}>Hint</button>
            <button type="button" onClick={() => coach("easier")}>Slow down</button>
            <button type="button" onClick={() => coach("harder")}>Harder</button>
            <button type="button" onClick={() => coach("quiz")}>Quiz me</button>
            <button type="button" onClick={() => coach("formula")}>Formula</button>
            <button type="button" onClick={() => coach("real")}>Real life</button>
            <button type="button" onClick={() => coach("notes")}>Save note</button>
            <button type="button" onClick={() => coach("skip")}>Skip?</button>
          </div>
          <div className="instruction-coach-log app-scrollbar">
            {coachEntries.map((entry) => (
              <p key={entry.id} className={entry.role === "learner" ? "is-learner" : ""}>
                {entry.content}
              </p>
            ))}
          </div>
          <form className="instruction-coach-form" onSubmit={submitCoachQuestion}>
            <input
              value={coachInput}
              onChange={(event) => setCoachInput(event.target.value)}
              placeholder="Ask for a hint or example"
            />
            <button type="submit" disabled={!coachInput.trim()} aria-label="Ask coach">
              <Send size={16} />
            </button>
          </form>
        </aside>
      </section>
    </main>
  );
}

function ConceptSlice({ step }: { step: LessonStep }) {
  return (
    <section className="instruction-concept">
      <div className="instruction-concept-main">
        <span>Skill being trained</span>
        <h3>{step.block.prompt}</h3>
        <p>{step.block.explanation}</p>
      </div>
      <div className="instruction-concept-grid">
        <article>
          <strong>Example</strong>
          <span>{step.block.example}</span>
        </article>
        <article>
          <strong>Non-example</strong>
          <span>{step.block.nonExample}</span>
        </article>
        <article>
          <strong>Common mistake</strong>
          <span>{step.block.commonMistake}</span>
        </article>
        <article>
          <strong>Why this matters</strong>
          <span>{step.block.whyItMatters}</span>
        </article>
      </div>
    </section>
  );
}

function SimulationSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="instruction-slider">
      <span>
        {label}
        <strong>{value}</strong>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function InstructionFeedbackCard({ feedback }: { feedback: Feedback }) {
  return (
    <aside className={`instruction-feedback ${feedback.tone === "success" ? "is-success" : "is-repair"}`}>
      {feedback.tone === "success" ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
      <div>
        <strong>{feedback.title}</strong>
        <p>{feedback.body}</p>
        {feedback.repair ? <span>{feedback.repair}</span> : null}
      </div>
    </aside>
  );
}

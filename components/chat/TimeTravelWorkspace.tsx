"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useReducer,
} from "react";
import {
  ArrowLeft,
  AlertTriangle,
  Compass,
  Coins,
  FileText,
  Gavel,
  Languages,
  MapPin,
  Search,
  ShieldCheck,
  Stamp,
  Thermometer,
  UserRound,
  Waypoints,
} from "lucide-react";
import type { ChatMessage as Message } from "@/components/chat/chat-message-model";
import {
  CoachChatSession,
  type CoachChatDetail,
} from "@/components/chat/CoachChatSession";
import { displayMessages } from "@/components/chat/message-display";
import { mergeStateReducer } from "@/components/chat/state-utils";
import type { Topic } from "@/components/chat/topic-model";
import { buildMiniAppInstruction } from "@/lib/ai/visible-content";

type TimeTravelStep = "departure" | "destination" | "identity" | "purpose" | "realism" | "depth" | "clearance";

type TimeTravelJourney = {
  id: string;
  label: string;
  place: string;
  date: string;
  arrival: string;
  context: string;
  season: string;
  jurisdiction: string;
  risk: string;
  confidence: string;
  languages: string[];
  currency: string;
  route: string[];
  eventClock: string[];
  people: string[];
  objects: string[];
  socialRules: string[];
  knownFacts: string[];
  reconstructions: string[];
  speculative: string[];
  actions: string[];
  sensory: string;
  exposureRisk: string;
};

type TimeTravelerIdentity = {
  id: string;
  label: string;
  role: string;
  description: string;
  languages: string;
  status: string;
  clothing: string;
  money: string;
  clearance: string;
};

type TimeTravelChoice = {
  id: string;
  label: string;
  description: string;
};

const timeTravelJourneyTemplates: TimeTravelJourney[] = [
  {
    id: "florence-1504",
    label: "Florence, 1504",
    place: "Florence",
    date: "September 1504",
    arrival: "Piazza della Signoria, near the newly installed David",
    context: "Republican Florence after the Medici expulsion, with guild politics and artistic patronage in public view.",
    season: "Early autumn",
    jurisdiction: "Florentine Republic",
    risk: "Moderate",
    confidence: "High for politics and major sites; mixed for street-level dialogue.",
    languages: ["Tuscan Italian", "Latin among educated elites"],
    currency: "Florin, soldi, small coinage",
    route: ["Piazza della Signoria", "Guild workshops", "Mercato Vecchio", "Arno crossings"],
    eventClock: ["David has become a civic symbol", "Guild alliances shape access", "Rumors about Medici return circulate"],
    people: ["Stone carver's apprentice", "Wool guild factor", "Humanist secretary"],
    objects: ["Florin coin", "Workshop chalk study", "Guild token"],
    socialRules: ["Patronage opens doors", "Public speech has factional weight", "Clothing signals rank quickly"],
    knownFacts: ["Michelangelo's David was installed in 1504", "Florence was a republic in this period", "Guilds shaped civic power"],
    reconstructions: ["Market noise, smells, and bargaining norms are inferred from urban records", "Ordinary conversations are plausible composites"],
    speculative: ["Specific private opinions of unnamed residents", "Exact sequence of a street encounter"],
    actions: ["Inspect the guild token", "Ask about the David", "Find a print seller"],
    sensory: "Stone dust, wool dye, bells, and sharp political glances under a crowded square.",
    exposureRisk: "Modern talk of individual artistic genius can sound naive without patronage, guild, and civic context.",
  },
  {
    id: "delhi-1857",
    label: "Delhi, 1857",
    place: "Delhi",
    date: "September 1857",
    arrival: "Market street near Chandni Chowk during the siege",
    context: "The Indian Rebellion of 1857 has made Delhi a contested imperial and military space.",
    season: "Late monsoon",
    jurisdiction: "Mughal symbolic authority under rebel control, contested by the East India Company",
    risk: "High",
    confidence: "High for major military events; mixed for ordinary household details.",
    languages: ["Hindustani", "Persian in elite records", "English among Company forces"],
    currency: "Rupees, silver coin, credit through trusted households",
    route: ["Chandni Chowk", "Kashmere Gate", "Red Fort approaches", "Merchant lanes"],
    eventClock: ["Siege pressure is rising", "Supplies and loyalties are strained", "Rumors move faster than verified news"],
    people: ["Merchant household scribe", "Water carrier", "Sepoy courier"],
    objects: ["Folded letter", "Silver rupee", "Cloth ration bundle"],
    socialRules: ["Questions about allegiance are dangerous", "Language and dress signal risk", "Movement needs a plausible errand"],
    knownFacts: ["Delhi was a central site in the 1857 rebellion", "Kashmere Gate was militarily significant", "Bahadur Shah Zafar became a symbolic focus"],
    reconstructions: ["Street-level errands and household anxieties are built from memoirs and social history", "Unnamed residents are composites"],
    speculative: ["Exact words spoken by ordinary people", "Private motivations without records"],
    actions: ["Deliver the folded letter", "Ask a water carrier what locals know", "Compare rebel and Company information"],
    sensory: "Wet dust, shouted rumors, smoke, prayer calls, and the metallic anxiety of a city under pressure.",
    exposureRisk: "Asking openly who will win could expose you; people here do not have historian hindsight.",
  },
  {
    id: "athens-399-bce",
    label: "Athens, 399 BCE",
    place: "Athens",
    date: "399 BCE",
    arrival: "Agora during the days around Socrates' trial",
    context: "Democratic Athens is recovering from war, oligarchic trauma, and civic suspicion.",
    season: "Spring",
    jurisdiction: "Athenian democracy",
    risk: "Moderate",
    confidence: "High for broad civic institutions; contested for Socrates' exact voice and motives.",
    languages: ["Attic Greek"],
    currency: "Drachmae and obols",
    route: ["Agora", "Stoa Basileios", "Law courts", "Workshops near the square"],
    eventClock: ["Trial talk travels through civic spaces", "Recent political wounds remain raw", "Citizens weigh piety, education, and loyalty"],
    people: ["Potter-citizen", "Metic trader", "Young rhetoric student"],
    objects: ["Ostrakon shard", "Oil flask", "Wax tablet"],
    socialRules: ["Citizenship determines political voice", "Public argument is social performance", "Piety is civic, not private only"],
    knownFacts: ["Socrates was tried and executed in 399 BCE", "The Athenian agora was a civic center", "Citizenship was restricted"],
    reconstructions: ["Ordinary reactions are plausible blends of legal and literary evidence", "Street routes are approximate"],
    speculative: ["How any single bystander felt about Socrates", "Exact trial-day crowd movement"],
    actions: ["Attend court gossip", "Ask a metic what citizenship excludes", "Inspect the ostrakon"],
    sensory: "Olive oil, dust, bronze, public argument, and the uneasy pride of a wounded democracy.",
    exposureRisk: "Modern assumptions about equal citizenship would be immediately out of place.",
  },
  {
    id: "changan-742",
    label: "Chang'an, 742",
    place: "Chang'an",
    date: "742 CE",
    arrival: "West Market during the Tang dynasty",
    context: "Tang Chang'an is a cosmopolitan imperial capital linked to steppe, Central Asian, and Buddhist networks.",
    season: "Late spring",
    jurisdiction: "Tang Empire under Emperor Xuanzong",
    risk: "Low to moderate",
    confidence: "High for city planning and cosmopolitan trade; mixed for market micro-scenes.",
    languages: ["Middle Chinese", "Sogdian among some merchants", "Sanskrit in Buddhist contexts"],
    currency: "Copper cash, bolts of cloth, credit relationships",
    route: ["West Market", "Ward gates", "Buddhist monastery", "Administrative avenues"],
    eventClock: ["Markets operate under timed gates", "Foreign merchants gather in regulated spaces", "Court culture is near its high point"],
    people: ["Sogdian trader", "Monastery translator", "Market inspector"],
    objects: ["Copper cash string", "Perfume resin", "Buddhist manuscript fragment"],
    socialRules: ["Curfews and ward gates matter", "Officials control market order", "Foreignness can be useful and watched"],
    knownFacts: ["Chang'an was the Tang capital", "The West Market hosted long-distance trade", "Ward systems structured urban life"],
    reconstructions: ["Market characters are composites", "Specific prices vary by evidence and period"],
    speculative: ["Exact merchant dialogue", "Precise sensory mix at a given stall"],
    actions: ["Bargain for resin", "Visit a translation hall", "Trace a trade route on the map"],
    sensory: "Horse sweat, incense, lacquer, copper cash, and languages braided through a regulated market.",
    exposureRisk: "Missing the curfew or ignoring official rank can quickly become dangerous.",
  },
  {
    id: "london-1666",
    label: "London, 1666",
    place: "London",
    date: "2 September 1666",
    arrival: "Pudding Lane as fire begins to spread",
    context: "Restoration London faces plague memory, dense timber housing, and a fire that will reshape the city.",
    season: "Dry late summer",
    jurisdiction: "Kingdom of England under Charles II",
    risk: "Very high",
    confidence: "High for the Great Fire timeline; mixed for exact street-level encounters.",
    languages: ["Early Modern English"],
    currency: "Pounds, shillings, pence",
    route: ["Pudding Lane", "London Bridge approaches", "St Paul's area", "River stairs"],
    eventClock: ["Fire spreads with wind and dense buildings", "Householders try to save goods", "Authorities debate demolition"],
    people: ["Baker's neighbor", "River boatman", "Parish watchman"],
    objects: ["Leather fire bucket", "Household ledger", "Bread peel"],
    socialRules: ["Parish ties matter", "Rumor can turn against outsiders", "Property and survival decisions collide"],
    knownFacts: ["The Great Fire began in 1666", "Pudding Lane is associated with the outbreak", "St Paul's Cathedral was destroyed"],
    reconstructions: ["Individual routes through smoke are plausible, not exact", "Ordinary speech is period-informed reconstruction"],
    speculative: ["A named bystander's private thoughts", "Exact timing of every alley evacuation"],
    actions: ["Help carry ledgers", "Find the river stairs", "Ask the watchman what orders exist"],
    sensory: "Hot tar, panicked footsteps, bells, smoke, and the crack of timber in a city built too tightly.",
    exposureRisk: "Standing idle with strange questions during a disaster invites suspicion.",
  },
  {
    id: "fatehpur-sikri-1582",
    label: "Fatehpur Sikri, 1582",
    place: "Fatehpur Sikri",
    date: "1582 CE",
    arrival: "Near Akbar's imperial complex and debate spaces",
    context: "Akbar's Mughal court is experimenting with sovereignty, translation, religion, and imperial administration.",
    season: "Cool season",
    jurisdiction: "Mughal Empire under Akbar",
    risk: "Moderate",
    confidence: "High for court culture and imperial policy; mixed for ordinary court-adjacent life.",
    languages: ["Persian", "Hindavi", "Arabic and Sanskrit in scholarly contexts"],
    currency: "Rupee, dam, gifts, patronage obligations",
    route: ["Diwan-i-Khas precinct", "Imperial workshops", "Market outside the complex", "Scholarly gathering"],
    eventClock: ["Translation projects carry prestige", "Religious debate is politically charged", "Court access depends on patronage"],
    people: ["Court translator", "Workshop painter", "Rajput retainer"],
    objects: ["Illustrated manuscript folio", "Copper dam", "Perfumed petition paper"],
    socialRules: ["Rank controls speech", "Gifts and introductions matter", "Religious language needs care"],
    knownFacts: ["Akbar ruled the Mughal Empire in this period", "Fatehpur Sikri was an imperial center", "Court translation and debate were significant"],
    reconstructions: ["Workshop routines are plausible reconstructions", "Unnamed court figures are composites"],
    speculative: ["Exact conversations inside elite spaces", "Private motives behind every policy"],
    actions: ["Meet a translator", "Inspect a manuscript folio", "Ask how patronage works"],
    sensory: "Red sandstone heat, ink, perfumed paper, controlled silence, and many languages orbiting power.",
    exposureRisk: "Treating religion as private opinion rather than public order would sound strange and possibly dangerous.",
  },
  {
    id: "paris-1789",
    label: "Paris, July 1789",
    place: "Paris",
    date: "13 July 1789",
    arrival: "Faubourg Saint-Antoine on the eve of the Bastille",
    context: "Food prices, rumors, royal politics, and armed crowds are pushing Paris toward a decisive rupture.",
    season: "Summer",
    jurisdiction: "Kingdom of France in revolutionary crisis",
    risk: "High",
    confidence: "High for the political moment; mixed for crowd-level motivations.",
    languages: ["French"],
    currency: "Livres, sous, bread prices as daily pressure",
    route: ["Faubourg Saint-Antoine", "Palais-Royal", "Les Invalides", "Bastille approaches"],
    eventClock: ["Rumors about royal troops spread", "Crowds search for arms", "Bread and legitimacy dominate talk"],
    people: ["Journeyman printer", "Market woman", "National Guard volunteer"],
    objects: ["Pamphlet", "Bread token", "Pike head"],
    socialRules: ["Political language can mobilize or endanger", "Crowds test loyalty fast", "Bread is politics"],
    knownFacts: ["The Bastille fell on 14 July 1789", "Paris was politically volatile", "Pamphlets shaped public opinion"],
    reconstructions: ["Individual crowd interactions are plausible composites", "Exact street conversations are inferred"],
    speculative: ["Specific intent of unnamed participants", "Whether one encounter changes a crowd's direction"],
    actions: ["Read the pamphlet aloud", "Ask about bread prices", "Follow the arms rumor"],
    sensory: "Printer's ink, sweat, bread queues, ironwork, and a city discovering its own force.",
    exposureRisk: "Overconfident modern slogans can be misread; local grievances and fear carry the moment.",
  },
  {
    id: "ostia-117",
    label: "Ostia, 117 CE",
    place: "Ostia",
    date: "117 CE",
    arrival: "Harbor warehouses near Rome's grain supply",
    context: "The Roman Empire under Trajan's final year depends on ports, credit, labor, and imperial logistics.",
    season: "Late summer",
    jurisdiction: "Roman Empire",
    risk: "Moderate",
    confidence: "High for port infrastructure and trade systems; mixed for individual merchant routines.",
    languages: ["Latin", "Greek among traders"],
    currency: "Denarii, sestertii, credit and contracts",
    route: ["Warehouses", "Harbor basin", "Guild office", "Tavern near the docks"],
    eventClock: ["Ships unload grain and oil", "Guilds coordinate labor", "News from the imperial frontier travels slowly"],
    people: ["Freedman accountant", "Dock laborer", "Greek shipmaster"],
    objects: ["Amphora stamp", "Wax contract tablet", "Denarius"],
    socialRules: ["Status follows legal category", "Patrons protect access", "Contracts matter more than charm"],
    knownFacts: ["Ostia served Rome's supply system", "Roman trade used amphorae and contracts", "Legal status shaped daily life"],
    reconstructions: ["Specific price comparisons vary", "Ordinary characters are evidence-aware composites"],
    speculative: ["Exact tavern conversations", "A single merchant's private plan"],
    actions: ["Inspect the amphora stamp", "Negotiate a delivery", "Ask how freed status works"],
    sensory: "Salt air, olive oil, rope fiber, shouted accounts, and the heavy logistics behind imperial abundance.",
    exposureRisk: "Ignoring slavery, freed status, and patronage would make your assumptions visibly modern.",
  },
];

const timeTravelerIdentities: TimeTravelerIdentity[] = [
  {
    id: "guided-self",
    label: "Yourself with a guide",
    role: "Out-of-time observer with a discreet field guide",
    description: "Safer, more explanatory, and allowed to ask modern comparisons.",
    languages: "Guide translates, but locals notice hesitation.",
    status: "Protected outsider",
    clothing: "Conservative local outer layers chosen by the guide",
    money: "Small supervised purse",
    clearance: "Educational clearance",
  },
  {
    id: "plausible-local",
    label: "Plausible local",
    role: "Historically plausible resident attached to ordinary networks",
    description: "More immersive, with tighter limits on what you can know and say.",
    languages: "Local working language with class-appropriate fluency",
    status: "Non-elite but socially legible",
    clothing: "Period-appropriate clothing matched to status",
    money: "Small reserve in local coin or credit",
    clearance: "Immersion clearance",
  },
  {
    id: "trade-assistant",
    label: "Merchant assistant",
    role: "Assistant to a trading household or workshop",
    description: "Best for money, logistics, food, routes, and social exchange.",
    languages: "Trade phrases plus household vocabulary",
    status: "Useful but supervised",
    clothing: "Workable travel clothing",
    money: "Account tokens and a modest coin pouch",
    clearance: "Commercial clearance",
  },
  {
    id: "scribe-translator",
    label: "Scribe or translator",
    role: "Literate helper near records, letters, or multilingual exchange",
    description: "Best for politics, institutions, evidence, and elite-adjacent spaces.",
    languages: "Reading knowledge plus formal speech routines",
    status: "Literate non-elite",
    clothing: "Plain respectable dress with writing tools",
    money: "Small silver or copper reserve",
    clearance: "Document clearance",
  },
];

const timeTravelPurposes: TimeTravelChoice[] = [
  { id: "observe", label: "Observe", description: "Move carefully and notice ordinary life before judging." },
  { id: "investigate", label: "Investigate", description: "Follow a historical question through people, objects, and power." },
  { id: "survive", label: "Survive", description: "Food, shelter, suspicion, money, and risk matter from the first step." },
  { id: "meet-moment", label: "Meet the moment", description: "Arrive near a turning point and track what people know then." },
  { id: "compare", label: "Compare to today", description: "Keep governance, money, labor, technology, and culture in view." },
];

const timeTravelRealism: TimeTravelChoice[] = [
  { id: "guided", label: "Guided", description: "Safe, explanatory, and easier to pause for context." },
  { id: "strict", label: "Strict", description: "No modern hindsight in-world; status, danger, and access are enforced." },
  { id: "source-heavy", label: "Source-heavy", description: "Frequent evidence notes and uncertainty labels." },
];

const timeTravelDepth: TimeTravelChoice[] = [
  { id: "short", label: "10-minute visit", description: "One tight arrival, three discoveries, and a debrief stamp." },
  { id: "guided-expedition", label: "Guided expedition", description: "Several locations, figures, artifacts, and field notes." },
  { id: "open-simulation", label: "Open simulation", description: "Stateful exploration with consequences and evolving risk." },
];

const fallbackTimeTravelJourney: TimeTravelJourney = {
  ...timeTravelJourneyTemplates[0],
  id: "saved-expedition",
  label: "Saved expedition",
  place: "Active destination",
  date: "Saved arrival point",
  arrival: "Current scene",
  context: "Continue the existing historical expedition from the conversation.",
  risk: "Unknown",
  confidence: "Read from the current evidence notes.",
};

function resolveJourneyOptions(intent: string) {
  const query = intent.toLowerCase();
  if (!query.trim()) return timeTravelJourneyTemplates.slice(0, 5);
  if (/mughal|akbar|shah jahan|fatehpur|court/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "fatehpur-sikri-1582")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "delhi-1857")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "ostia-117")!,
    ];
  }
  if (/french|revolution|bastille|paris/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "paris-1789")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "london-1666")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "athens-399-bce")!,
    ];
  }
  if (/roman|rome|trader|trade|merchant/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "ostia-117")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "changan-742")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "fatehpur-sikri-1582")!,
    ];
  }
  if (/battle|war|siege|rebellion|revolt/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "delhi-1857")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "paris-1789")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "london-1666")!,
    ];
  }
  if (/athens|socrates|greek|democracy/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "athens-399-bce")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "florence-1504")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "paris-1789")!,
    ];
  }
  if (/china|tang|silk|chang/.test(query)) {
    return [
      timeTravelJourneyTemplates.find((journey) => journey.id === "changan-742")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "fatehpur-sikri-1582")!,
      timeTravelJourneyTemplates.find((journey) => journey.id === "ostia-117")!,
    ];
  }

  return [
    buildCustomJourney(intent, "Center of power", "court, assembly, palace, command tent, or administrative center"),
    buildCustomJourney(intent, "Street-level life", "market, household, workshop, port, school, or neighborhood"),
    buildCustomJourney(intent, "Edge of the system", "frontier, trade route, borderland, ship, monastery, or garrison"),
  ];
}

function buildCustomJourney(intent: string, label: string, arrival: string): TimeTravelJourney {
  const cleanIntent = intent.trim() || "A historical turning point";
  return {
    id: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${cleanIntent.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 28)}`,
    label,
    place: cleanIntent,
    date: "AI-resolved date range",
    arrival,
    context: "The Travel Designer should resolve this intent into a specific historical place, date, and political moment before arrival.",
    season: "To be resolved",
    jurisdiction: "To be resolved",
    risk: "Pending",
    confidence: "Pending evidence check",
    languages: ["To be resolved"],
    currency: "To be resolved",
    route: ["Arrival point", "Ordinary-life node", "Power node", "Exit route"],
    eventClock: ["Resolve the event clock before opening the world", "Separate in-world knowledge from historian knowledge"],
    people: ["Local guide", "Ordinary worker", "Gatekeeper to power"],
    objects: ["Local coin or token", "Document or sign", "Food or tool"],
    socialRules: ["Resolve status rules", "Resolve language risk", "Resolve access limits"],
    knownFacts: ["The assistant must identify known facts before simulating"],
    reconstructions: ["Plausible ordinary life should be labelled as reconstruction"],
    speculative: ["Unverified details must stay visibly uncertain"],
    actions: ["Choose exact entry point", "Build passport", "Request source confidence"],
    sensory: "The first scene should become concrete only after the destination is resolved.",
    exposureRisk: "Unresolved until the historical setting is specified.",
  };
}

function buildTimeTravelPrompt({
  journey,
  identity,
  purpose,
  realism,
  depth,
}: {
  journey: TimeTravelJourney;
  identity: TimeTravelerIdentity;
  purpose: TimeTravelChoice;
  realism: TimeTravelChoice;
  depth: TimeTravelChoice;
}) {
  const state = {
    destination: {
      place: journey.place,
      date_range: journey.date,
      specific_arrival: journey.arrival,
      political_context: journey.context,
      season: journey.season,
      jurisdiction: journey.jurisdiction,
    },
    traveler: {
      identity_mode: identity.id,
      role: identity.role,
      languages: identity.languages,
      status: identity.status,
      clothing: identity.clothing,
      money: identity.money,
    },
    simulation: {
      realism_level: realism.label,
      risk_level: journey.risk,
      current_location: journey.arrival,
      mode: purpose.label,
      depth: depth.label,
      event_clock: journey.eventClock,
    },
    evidence: {
      confidence: journey.confidence,
      known_facts: journey.knownFacts,
      plausible_reconstructions: journey.reconstructions,
      speculative_elements: journey.speculative,
    },
  };

  return buildMiniAppInstruction({
    visible: `Time travel: ${journey.label} as ${identity.label}. Mission: ${purpose.label}.`,
    instructions: [
      "Start a Time Travel expedition. Do not open a generic chat and do not write a broad period summary.",
      "Treat this as a stateful, evidence-aware historical simulation with a passport, travel advisory, world view, and choices.",
      "Simulation state:",
      JSON.stringify(state, null, 2),
      "First response rules:",
      "- If any destination field is AI-resolved or vague, first offer three concrete historically meaningful arrival options and wait for the learner to choose.",
      "- Otherwise, greet the traveler, summarize the passport in one compact paragraph, then ask the first meaningful action question.",
      "- Keep in-world knowledge separate from historian knowledge.",
      "- Mark known facts, plausible reconstruction, and speculation clearly.",
      "- Do not fabricate direct quotes, citations, or private thoughts.",
      "- Do not romanticize violence, empire, slavery, caste, disease, or oppression.",
      "- Apply constraints around language, rank, gender, class, law, religion, money, sanitation, and access.",
      "- End with three meaningful actions plus one option to pause for historian context.",
      "Debrief rule: when the learner asks to end or debrief, summarize discoveries, evidence confidence, remaining uncertainties, and award a passport stamp.",
    ].join("\n"),
  });
}

export function TimeTravelWorkspace({
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
  const visibleMessages = displayMessages(messages);
  const hasSession = messages.some((message) => message.role !== "system") || sending || awaitingResponse;
  const [
    { intent, step, journeyOptions, selectedJourney, identityId, purposeId, realismId, depthId },
    updateTimeTravel,
  ] = useReducer(mergeStateReducer<{
    intent: string;
    step: TimeTravelStep;
    journeyOptions: TimeTravelJourney[];
    selectedJourney: TimeTravelJourney | null;
    identityId: string;
    purposeId: string;
    realismId: string;
    depthId: string;
  }>, {
    intent: "",
    step: "departure",
    journeyOptions: timeTravelJourneyTemplates.slice(0, 5),
    selectedJourney: null,
    identityId: "",
    purposeId: "",
    realismId: "",
    depthId: "",
  });

  const identity = timeTravelerIdentities.find((option) => option.id === identityId);
  const purpose = timeTravelPurposes.find((option) => option.id === purposeId);
  const realism = timeTravelRealism.find((option) => option.id === realismId);
  const depth = timeTravelDepth.find((option) => option.id === depthId);

  function resolveIntent(event?: FormEvent) {
    event?.preventDefault();
    updateTimeTravel({
      journeyOptions: resolveJourneyOptions(intent),
      selectedJourney: null,
      step: "destination",
    });
  }

  function selectJourney(journey: TimeTravelJourney) {
    updateTimeTravel({ selectedJourney: journey, step: "identity" });
  }

  function sendRandomJourney() {
    const journey =
      timeTravelJourneyTemplates[Math.floor(Math.random() * timeTravelJourneyTemplates.length)] ??
      timeTravelJourneyTemplates[0];
    updateTimeTravel({
      intent: journey.label,
      journeyOptions: resolveJourneyOptions(journey.label),
      selectedJourney: journey,
      step: "identity",
    });
  }

  function beginJourney() {
    if (!selectedJourney || !identity || !purpose || !realism || !depth || sending) return;
    void onSend(buildTimeTravelPrompt({ journey: selectedJourney, identity, purpose, realism, depth }));
  }

  if (hasSession) {
    return (
      <TimeTravelSession
        topic={topic}
        userName={userName}
        journey={selectedJourney ?? fallbackTimeTravelJourney}
        identity={identity ?? timeTravelerIdentities[0]}
        purpose={purpose}
        realism={realism}
        depth={depth}
        messages={visibleMessages}
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

  return (
    <main className="inspir-workspace inspir-time-workspace">
      <div className="inspir-time-scroll app-scrollbar">
        <section className="inspir-time-onboarding">
          <div className="inspir-time-stage">
            {step === "departure" ? (
              <TimeTravelDepartureBoard
                intent={intent}
                topic={topic}
                onIntent={(nextIntent) => updateTimeTravel({ intent: nextIntent })}
                onResolve={resolveIntent}
                onRandom={sendRandomJourney}
                onSelect={selectJourney}
              />
            ) : step === "destination" ? (
              <TimeTravelDestinationStep
                intent={intent}
                options={journeyOptions}
                onBack={() => updateTimeTravel({ step: "departure" })}
                onSelect={selectJourney}
              />
            ) : step === "identity" ? (
              <TimeTravelChoiceStep
                kicker="Traveler identity"
                title="How do you want to be seen when you arrive?"
                body="Your status controls language, money, access, danger, and what questions sound natural."
                choices={timeTravelerIdentities}
                selectedId={identityId}
                onSelect={(id) => {
                  updateTimeTravel({ identityId: id, step: "purpose" });
                }}
                onBack={() => updateTimeTravel({ step: "destination" })}
              />
            ) : step === "purpose" ? (
              <TimeTravelChoiceStep
                kicker="Mission"
                title="What kind of journey is this?"
                body="The simulation will prioritize different people, risks, objects, and explanations."
                choices={timeTravelPurposes}
                selectedId={purposeId}
                onSelect={(id) => {
                  updateTimeTravel({ purposeId: id, step: "realism" });
                }}
                onBack={() => updateTimeTravel({ step: "identity" })}
              />
            ) : step === "realism" ? (
              <TimeTravelChoiceStep
                kicker="Realism"
                title="How strict should the crossing be?"
                body="Strict mode keeps modern knowledge out of the world and applies social consequences sooner."
                choices={timeTravelRealism}
                selectedId={realismId}
                onSelect={(id) => {
                  updateTimeTravel({ realismId: id, step: "depth" });
                }}
                onBack={() => updateTimeTravel({ step: "purpose" })}
              />
            ) : step === "depth" ? (
              <TimeTravelChoiceStep
                kicker="Duration"
                title="How deep should the expedition go?"
                body="Short visits end with a fast debrief; open simulations keep state and consequences active."
                choices={timeTravelDepth}
                selectedId={depthId}
                onSelect={(id) => {
                  updateTimeTravel({ depthId: id, step: "clearance" });
                }}
                onBack={() => updateTimeTravel({ step: "realism" })}
              />
            ) : (
              <TimeTravelClearance
                journey={selectedJourney ?? fallbackTimeTravelJourney}
                identity={identity}
                purpose={purpose}
                realism={realism}
                depth={depth}
                sending={sending}
                onBack={() => updateTimeTravel({ step: "depth" })}
                onBegin={beginJourney}
              />
            )}
          </div>
          <TimeTravelPassport
            journey={selectedJourney}
            identity={identity}
            purpose={purpose}
            realism={realism}
            depth={depth}
          />
        </section>
      </div>
    </main>
  );
}

function TimeTravelDepartureBoard({
  intent,
  topic,
  onIntent,
  onResolve,
  onRandom,
  onSelect,
}: {
  intent: string;
  topic: Topic;
  onIntent: (value: string) => void;
  onResolve: (event?: FormEvent) => void;
  onRandom: () => void;
  onSelect: (journey: TimeTravelJourney) => void;
}) {
  const featured = timeTravelJourneyTemplates.slice(0, 5);

  return (
    <div className="inspir-time-departure">
      <header className="inspir-time-hero">
        <div>
          <span>{topic.name}</span>
          <h2>Departures beyond the present</h2>
        </div>
        <button type="button" onClick={onRandom} className="inspir-time-icon-button">
          <Waypoints size={18} />
          <span>Send me somewhere consequential</span>
        </button>
      </header>

      <form className="inspir-time-search-board" onSubmit={onResolve}>
        <Search size={20} />
        <input
          aria-label="Time travel destination"
          value={intent}
          onChange={(event) => onIntent(event.target.value)}
          placeholder="Where and when do you want to go?"
        />
        <button type="submit">
          <Compass size={18} />
          <span>Resolve</span>
        </button>
      </form>

      <div className="inspir-time-map-board" aria-label="Historical hotspots">
        {featured.map((journey) => (
          <button key={journey.id} type="button" onClick={() => onSelect(journey)} className="inspir-time-hotspot">
            <MapPin size={16} />
            <span>{journey.label}</span>
          </button>
        ))}
      </div>

      <ol className="inspir-time-timeline-stops">
        {featured.map((journey) => (
          <li key={journey.id}>
            <button type="button" onClick={() => onSelect(journey)}>
              <span>{journey.date}</span>
              <strong>{journey.place}</strong>
            </button>
          </li>
        ))}
      </ol>

      <div className="inspir-time-journey-grid">
        {timeTravelJourneyTemplates.slice(0, 6).map((journey) => (
          <button key={journey.id} type="button" onClick={() => onSelect(journey)} className="inspir-time-journey-card">
            <span>{journey.label}</span>
            <strong>{journey.arrival}</strong>
            <small>{journey.context}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeTravelDestinationStep({
  intent,
  options,
  onBack,
  onSelect,
}: {
  intent: string;
  options: TimeTravelJourney[];
  onBack: () => void;
  onSelect: (journey: TimeTravelJourney) => void;
}) {
  return (
    <div className="inspir-time-question">
      <button type="button" onClick={onBack} className="inspir-time-back">
        <ArrowLeft size={17} />
        <span>Departure board</span>
      </button>
      <span>Arrival point</span>
      <h2>{intent.trim() ? "Choose the strongest entry point." : "Choose your arrival point."}</h2>
      <p>Center of power, street-level life, and the edge of the system reveal different histories.</p>
      <div className="inspir-time-option-grid">
        {options.map((journey) => (
          <button key={journey.id} type="button" onClick={() => onSelect(journey)} className="inspir-time-option-card">
            <strong>{journey.label}</strong>
            <span>{journey.arrival}</span>
            <small>{journey.context}</small>
            <em>{journey.confidence}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeTravelChoiceStep({
  kicker,
  title,
  body,
  choices,
  selectedId,
  onSelect,
  onBack,
}: {
  kicker: string;
  title: string;
  body: string;
  choices: Array<TimeTravelChoice | TimeTravelerIdentity>;
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="inspir-time-question">
      <button type="button" onClick={onBack} className="inspir-time-back">
        <ArrowLeft size={17} />
        <span>Back</span>
      </button>
      <span>{kicker}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="inspir-time-option-grid">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => onSelect(choice.id)}
            className={`inspir-time-option-card ${choice.id === selectedId ? "is-selected" : ""}`}
          >
            <strong>{choice.label}</strong>
            <span>{"role" in choice ? choice.role : choice.description}</span>
            <small>{"status" in choice ? `${choice.status} - ${choice.languages}` : choice.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeTravelClearance({
  journey,
  identity,
  purpose,
  realism,
  depth,
  sending,
  onBack,
  onBegin,
}: {
  journey: TimeTravelJourney;
  identity?: TimeTravelerIdentity;
  purpose?: TimeTravelChoice;
  realism?: TimeTravelChoice;
  depth?: TimeTravelChoice;
  sending: boolean;
  onBack: () => void;
  onBegin: () => void;
}) {
  const ready = Boolean(identity && purpose && realism && depth);
  return (
    <div className="inspir-time-clearance">
      <button type="button" onClick={onBack} className="inspir-time-back">
        <ArrowLeft size={17} />
        <span>Back</span>
      </button>
      <div className="inspir-time-clearance-head">
        <ShieldCheck size={28} />
        <div>
          <span>Travel advisory</span>
          <h2>{journey.arrival}</h2>
        </div>
      </div>
      <div className="inspir-time-advisory-grid">
        <TimeTravelAdvisoryItem icon="language" label="Languages" value={journey.languages.join(", ")} />
        <TimeTravelAdvisoryItem icon="risk" label="Risk" value={`${journey.risk} - ${journey.exposureRisk}`} />
        <TimeTravelAdvisoryItem icon="money" label="Money" value={identity?.money ?? journey.currency} />
        <TimeTravelAdvisoryItem icon="status" label="Status" value={identity?.status ?? "Pending identity clearance"} />
        <TimeTravelAdvisoryItem icon="rules" label="Do not forget" value={journey.socialRules[0] ?? "Local rules apply"} />
        <TimeTravelAdvisoryItem icon="evidence" label="Evidence" value={journey.confidence} />
      </div>
      <div className="inspir-time-warning">
        <AlertTriangle size={20} />
        <span>{journey.exposureRisk}</span>
      </div>
      <button type="button" disabled={!ready || sending} onClick={onBegin} className="inspir-time-enter-button">
        <Compass size={19} />
        <span>{journey.risk === "Very high" ? "Enter carefully" : "Enter the city"}</span>
      </button>
    </div>
  );
}

const timeTravelAdvisoryIcons = {
  language: Languages,
  risk: Thermometer,
  money: Coins,
  status: UserRound,
  rules: Gavel,
  evidence: FileText,
};

type TimeTravelAdvisoryIcon = keyof typeof timeTravelAdvisoryIcons;

function TimeTravelAdvisoryItem({
  icon,
  label,
  value,
}: {
  icon: TimeTravelAdvisoryIcon;
  label: string;
  value: string;
}) {
  const Icon = timeTravelAdvisoryIcons[icon];
  return (
    <article className="inspir-time-advisory-item">
      <Icon size={19} />
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
    </article>
  );
}

function TimeTravelPassport({
  journey,
  identity,
  purpose,
  realism,
  depth,
  compact = false,
}: {
  journey: TimeTravelJourney | null;
  identity?: TimeTravelerIdentity;
  purpose?: TimeTravelChoice;
  realism?: TimeTravelChoice;
  depth?: TimeTravelChoice;
  compact?: boolean;
}) {
  const stamps = [
    journey ? "Destination" : undefined,
    identity ? "Identity" : undefined,
    purpose ? "Mission" : undefined,
    realism ? "Realism" : undefined,
    depth ? "Depth" : undefined,
  ].filter(Boolean);

  return (
    <aside className={`inspir-time-passport ${compact ? "is-compact" : ""}`}>
      <div className="inspir-time-passport-cover">
        <div>
          <span>Temporal passport</span>
          <h3>{journey?.label ?? "Clearance pending"}</h3>
        </div>
        <Stamp size={28} />
      </div>
      <dl className="inspir-time-passport-fields">
        <div>
          <dt>Destination</dt>
          <dd>{journey?.arrival ?? "Choose an arrival point"}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{journey?.date ?? "Unstamped"}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{identity?.role ?? "Identity pending"}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{identity?.languages ?? journey?.languages.join(", ") ?? "Pending"}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{journey?.risk ?? "Pending"}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{purpose?.label ?? "Mission pending"}</dd>
        </div>
      </dl>
      <div className="inspir-time-stamps">
        {stamps.length ? (
          stamps.map((stamp) => <span key={stamp}>{stamp}</span>)
        ) : (
          <span>Awaiting first stamp</span>
        )}
      </div>
    </aside>
  );
}

function TimeTravelSession({
  topic,
  userName,
  journey,
  identity,
  purpose,
  realism,
  depth,
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
  journey: TimeTravelJourney;
  identity: TimeTravelerIdentity;
  purpose?: TimeTravelChoice;
  realism?: TimeTravelChoice;
  depth?: TimeTravelChoice;
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
  const actions = [
    ...journey.actions,
    "Ask the guide to explain the power structure",
    "Compare this with today",
    "Request debrief and passport stamp",
  ];

  function sendAction(action: string) {
    void onSend(
      buildMiniAppInstruction({
        visible: action,
        instructions: `Action from inside the ${journey.label} expedition: ${action}. Keep the simulation state, constraints, and evidence labels visible.`,
      }),
    );
  }

  const details: CoachChatDetail[] = [
    { title: "Arrival", body: `${journey.arrival} - ${journey.date}`, icon: MapPin },
    { title: "Identity", body: `${identity.role}. ${identity.status}.`, icon: UserRound },
    { title: "Mission", body: `${purpose?.label ?? "Guided"} - ${depth?.label ?? "Open visit"}`, icon: Compass },
    { title: "Realism", body: `${realism?.label ?? "Guided"} realism. ${journey.risk} risk.`, icon: ShieldCheck },
    { title: "Evidence", body: journey.confidence, icon: FileText },
    { title: "Boundary", body: journey.exposureRisk, icon: AlertTriangle },
  ];

  return (
    <CoachChatSession
      eyebrow={topic.name}
      title={journey.place}
      subtitle={`${journey.arrival} - ${identity.role}`}
      userName={userName}
      coachName="Guide"
      placeholder="Ask, act, pause for context, or request a debrief..."
      messages={messages}
      input={input}
      sending={sending}
      awaitingResponse={awaitingResponse}
      inputRef={inputRef}
      listRef={listRef}
      actions={actions.slice(0, 6).map((action) => ({
        label: action,
        icon: Compass,
        disabled: sending,
        onClick: () => sendAction(action),
      }))}
      details={details}
      resetLabel="Change passport"
      onInput={onInput}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      onStop={onStop}
      onReset={onReset}
    />
  );
}

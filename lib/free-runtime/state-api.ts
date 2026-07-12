import {
  appendNativeSessionRefresh,
  nativeAuthHmacBytes,
  privateNoStoreHeaders,
  requireNativeSession,
  type NativeAuthenticatedSession,
  type NativeSessionEnv,
} from "./native-session";
import { languageConfigs, normalizeLanguage, type SupportedLanguage } from "../content/languages";
import { refreshNativeAdminTotals } from "./admin-metrics";

export const NATIVE_STATE_API_DELIVERY = "lean-api-worker";
// Queue jobs only retain a 2,000-character question and 1,000-character answer.
// Keep a small parsing margin without re-materializing legacy 120 KiB rows.
export const MAX_QUEUED_USER_MESSAGE_READ_CHARS = 2_201;
export const MAX_QUEUED_ASSISTANT_MESSAGE_READ_CHARS = 1_201;
export const MAX_RATE_LIMIT_PRUNE_ROWS = 5_000;
export const MAX_STALE_AI_RUN_REPAIRS = 500;
export const MAX_RECENT_CHAT_RESULTS = 100;
export const STATE_API_INCREMENTAL_CONTRACT_HEADER = "x-inspir-state-contract";
export const STATE_API_INCREMENTAL_CONTRACT_VALUE = "incremental-v2";
export const MAX_CHAT_SEARCH_CANDIDATES = 200;
export const MAX_CHAT_SEARCH_MESSAGES_PER_CHAT = 40;
export const MAX_CHAT_REPLY_COUNT_SCAN = 200;
export const MAX_CHAT_SEARCH_MESSAGE_CHARS = 2_000;
export const MAX_MEMORY_SUMMARY_MESSAGE_COUNT = 500;
export const MAX_MEMORY_PROFILE_ROWS = 16;
export const MAX_MEMORY_PROFILE_CATEGORY_CHARS = 60;
export const MAX_MEMORY_PROFILE_SUMMARY_CHARS = 1_200;
export const MAX_MEMORY_SUMMARY_CHARS = 4_000;
export const MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS = 32_000;
export const MAX_MEMORY_SUMMARY_SECTIONS = 8;
export const MAX_MEMORY_SUMMARY_SECTION_ID_CHARS = 120;
export const MAX_MEMORY_SUMMARY_SECTION_TITLE_CHARS = 120;
export const MAX_MEMORY_SUMMARY_SECTION_SUMMARY_CHARS = 1_200;
export const MAX_MEMORY_SUMMARY_SECTION_SOURCE_IDS = 20;
export const MAX_MEMORY_SUMMARY_SECTION_SOURCE_ID_CHARS = 120;

// Every text column in these historical-memory reads is truncated in SQLite
// before it crosses the D1 boundary. The extra character is a truncation
// sentinel: response parsing either caps plain text or rejects incomplete JSON.
export const NATIVE_BOUNDED_MEMORY_SECTIONS_SQL = `select
  substr(sections, 1, ${MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS + 1}) as sections
from user_memory_summaries
where user_id = ?1
limit 1`;

export const NATIVE_BOUNDED_MEMORY_PROFILES_SQL = `select
  substr(category, 1, ${MAX_MEMORY_PROFILE_CATEGORY_CHARS + 1}) as category,
  substr(summary, 1, ${MAX_MEMORY_PROFILE_SUMMARY_CHARS + 1}) as summary,
  updated_at as updatedAt
from user_memory_profiles
where user_id = ?1
order by category asc
limit ${MAX_MEMORY_PROFILE_ROWS + 1}`;

export const NATIVE_BOUNDED_MEMORY_DASHBOARD_SUMMARY_SQL = `select
  substr(summary, 1, ${MAX_MEMORY_SUMMARY_CHARS + 1}) as summary,
  substr(sections, 1, ${MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS + 1}) as sections,
  last_synthesized_at as lastSynthesizedAt,
  updated_at as updatedAt
from user_memory_summaries
where user_id = ?1
limit 1`;

const maxStateRequestBytes = 16 * 1024;
const maxSavedChatMessages = 30;
const maxSavedChatResponseChars = 240_000;
const maxSavedMessageChars = 8_000;
const maxSavedMessageOffset = 16_000_000;
const maxJsonColumnChars = 128 * 1024;
const maxMemoryDisplayChars = 2_000;
const maxMemoryDashboardItems = 50;
const maxVectorCleanupRows = 2_000;
const maxDailySynthesisUsers = 25;
const maxSynthesisMemories = 40;
const maxSynthesisTurns = 12;
const oneDayMs = 24 * 60 * 60 * 1_000;
const oneHourMs = 60 * 60 * 1_000;
const anonymousAnalyticsSampleDivisor = 16;
const anonymousAnalyticsHourlyLimit = 12;
const signedInAnalyticsHourlyLimit = 60;
const defaultWriteFreezeRetrySeconds = 300;
const truthyValues = new Set(["1", "true", "yes", "on"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedProductEvents = new Set([
  "page_view",
  "auth_error_seen",
  "chat_message_sent",
  "profile_opened",
  "admin_opened",
]);
const memoryCategories = new Set([
  "identity",
  "preferences",
  "learning_style",
  "projects",
  "goals",
  "knowledge",
  "constraints",
  "interaction",
  "general",
]);

export type MemoryIntentLexicon = {
  rememberPrefix: string;
  forgetPrefix: string;
  preferencePrefix: string;
  identityPrefix: string;
};

export const memoryIntentLexicons: Record<SupportedLanguage, MemoryIntentLexicon> = {
  English: { rememberPrefix: "Remember this about me:", forgetPrefix: "Forget this about me:", preferencePrefix: "My preference is:", identityPrefix: "My name is:" },
  Hindi: { rememberPrefix: "मेरे बारे में यह याद रखें:", forgetPrefix: "मेरे बारे में यह भूल जाएँ:", preferencePrefix: "मेरी प्राथमिकता है:", identityPrefix: "मेरा नाम है:" },
  Spanish: { rememberPrefix: "Recuerda esto sobre mí:", forgetPrefix: "Olvida esto sobre mí:", preferencePrefix: "Mi preferencia es:", identityPrefix: "Mi nombre es:" },
  French: { rememberPrefix: "Rappelez-vous ceci à mon sujet :", forgetPrefix: "Oubliez ceci à mon sujet :", preferencePrefix: "Ma préférence est :", identityPrefix: "Mon nom est :" },
  German: { rememberPrefix: "Merke dir das über mich:", forgetPrefix: "Vergiss das über mich:", preferencePrefix: "Meine Präferenz ist:", identityPrefix: "Ich heiße:" },
  Italian: { rememberPrefix: "Ricorda questo di me:", forgetPrefix: "Dimentica questo di me:", preferencePrefix: "La mia preferenza è:", identityPrefix: "Mi chiamo:" },
  Portuguese: { rememberPrefix: "Lembre-se disto sobre mim:", forgetPrefix: "Esqueça isto sobre mim:", preferencePrefix: "Minha preferência é:", identityPrefix: "Meu nome é:" },
  Dutch: { rememberPrefix: "Onthoud dit over mij:", forgetPrefix: "Vergeet dit over mij:", preferencePrefix: "Mijn voorkeur is:", identityPrefix: "Mijn naam is:" },
  Russian: { rememberPrefix: "Запомни это обо мне:", forgetPrefix: "Забудь это обо мне:", preferencePrefix: "Я предпочитаю:", identityPrefix: "Меня зовут:" },
  Ukrainian: { rememberPrefix: "Запам'ятай це про мене:", forgetPrefix: "Забудь це про мене:", preferencePrefix: "Я віддаю перевагу:", identityPrefix: "Мене звати:" },
  Polish: { rememberPrefix: "Zapamiętaj to o mnie:", forgetPrefix: "Zapomnij to o mnie:", preferencePrefix: "Moje preferencje to:", identityPrefix: "Nazywam się:" },
  Romanian: { rememberPrefix: "Amintește-ți asta despre mine:", forgetPrefix: "Uită asta despre mine:", preferencePrefix: "Preferința mea este:", identityPrefix: "Numele meu este:" },
  Czech: { rememberPrefix: "Zapamatuj si o mně toto:", forgetPrefix: "Zapomeň na toto o mně:", preferencePrefix: "Moje preference je:", identityPrefix: "Jmenuji se:" },
  Hungarian: { rememberPrefix: "Emlékezz erre rólam:", forgetPrefix: "Ezt felejtsd el rólam:", preferencePrefix: "Az én preferenciám:", identityPrefix: "A nevem:" },
  Greek: { rememberPrefix: "Θυμήσου αυτό για μένα:", forgetPrefix: "Ξέχνα αυτό για μένα:", preferencePrefix: "Η προτίμησή μου είναι:", identityPrefix: "Το όνομά μου είναι:" },
  Turkish: { rememberPrefix: "Benim hakkımda şunu hatırla:", forgetPrefix: "Benim hakkımda şunu unut:", preferencePrefix: "Benim tercihim:", identityPrefix: "Benim adım:" },
  Arabic: { rememberPrefix: "تذكّر هذا عني:", forgetPrefix: "انسَ هذا عني:", preferencePrefix: "تفضيلي هو:", identityPrefix: "اسمي هو:" },
  Hebrew: { rememberPrefix: "זכור את זה עליי:", forgetPrefix: "שכח את זה עליי:", preferencePrefix: "ההעדפה שלי היא:", identityPrefix: "שמי הוא:" },
  Persian: { rememberPrefix: "این را دربارهٔ من به خاطر بسپار:", forgetPrefix: "این را دربارهٔ من فراموش کن:", preferencePrefix: "ترجیح من این است:", identityPrefix: "نام من این است:" },
  Urdu: { rememberPrefix: "میرے بارے میں یہ یاد رکھیں:", forgetPrefix: "میرے بارے میں یہ بھول جائیں:", preferencePrefix: "میری ترجیح یہ ہے:", identityPrefix: "میرا نام ہے:" },
  Bengali: { rememberPrefix: "আমার সম্পর্কে এটি মনে রাখুন:", forgetPrefix: "আমার সম্পর্কে এটি ভুলে যান:", preferencePrefix: "আমার পছন্দ হলো:", identityPrefix: "আমার নাম হলো:" },
  Tamil: { rememberPrefix: "என்னைப் பற்றி இதை நினைவில் கொள்ளுங்கள்:", forgetPrefix: "என்னைப் பற்றி இதை மறந்துவிடுங்கள்:", preferencePrefix: "எனது விருப்பம்:", identityPrefix: "என் பெயர்:" },
  Telugu: { rememberPrefix: "నా గురించి ఇది గుర్తుంచుకోండి:", forgetPrefix: "నా గురించి ఇది మరచిపోండి:", preferencePrefix: "నా అభిమతం:", identityPrefix: "నా పేరు:" },
  Marathi: { rememberPrefix: "माझ्याबद्दल हे लक्षात ठेवा:", forgetPrefix: "माझ्याबद्दल हे विसरा:", preferencePrefix: "माझे प्राधान्य आहे:", identityPrefix: "माझे नाव आहे:" },
  Gujarati: { rememberPrefix: "મારા વિશે આ યાદ રાખો:", forgetPrefix: "મારા વિશે આ ભૂલી જાઓ:", preferencePrefix: "મારી પસંદગી છે:", identityPrefix: "મારું નામ છે:" },
  Kannada: { rememberPrefix: "ನನ್ನ ಬಗ್ಗೆ ಇದನ್ನು ನೆನಪಿಡಿ:", forgetPrefix: "ನನ್ನ ಬಗ್ಗೆ ಇದನ್ನು ಮರೆತುಬಿಡಿ:", preferencePrefix: "ನನ್ನ ಆದ್ಯತೆ:", identityPrefix: "ನನ್ನ ಹೆಸರು:" },
  Malayalam: { rememberPrefix: "എന്നെക്കുറിച്ച് ഇത് ഓർക്കുക:", forgetPrefix: "എന്നെക്കുറിച്ച് ഇത് മറക്കുക:", preferencePrefix: "എന്റെ മുൻഗണന ഇതാണ്:", identityPrefix: "എന്റെ പേര്:" },
  Punjabi: { rememberPrefix: "ਮੇਰੇ ਬਾਰੇ ਇਹ ਯਾਦ ਰੱਖੋ:", forgetPrefix: "ਮੇਰੇ ਬਾਰੇ ਇਹ ਭੁੱਲ ਜਾਓ:", preferencePrefix: "ਮੇਰੀ ਤਰਜੀਹ ਹੈ:", identityPrefix: "ਮੇਰਾ ਨਾਮ ਹੈ:" },
  Odia: { rememberPrefix: "ମୋ ବିଷୟରେ ଏହା ମନେରଖ:", forgetPrefix: "ମୋ ବିଷୟରେ ଏହା ଭୁଲିଯାଅ:", preferencePrefix: "ମୋର ପସନ୍ଦ ହେଉଛି:", identityPrefix: "ମୋର ନାମ ହେଉଛି:" },
  Assamese: { rememberPrefix: "মোৰ বিষয়ে এইটো মনত ৰাখিব:", forgetPrefix: "মোৰ বিষয়ে এইটো পাহৰি যাওক:", preferencePrefix: "মোৰ পছন্দ হ'ল:", identityPrefix: "মোৰ নাম হৈছে:" },
  Nepali: { rememberPrefix: "मेरो बारेमा यो सम्झनुहोस्:", forgetPrefix: "मेरो बारेमा यो बिर्सनुहोस्:", preferencePrefix: "मेरो प्राथमिकता हो:", identityPrefix: "मेरो नाम हो:" },
  Sinhala: { rememberPrefix: "මා ගැන මෙය මතක තබා ගන්න:", forgetPrefix: "මා ගැන මෙය අමතක කරන්න:", preferencePrefix: "මගේ මනාපය:", identityPrefix: "මගේ නම වන්නේ:" },
  Chinese: { rememberPrefix: "请记住关于我的这一点：", forgetPrefix: "请忘记关于我的这一点：", preferencePrefix: "我的偏好是：", identityPrefix: "我的名字是：" },
  Japanese: { rememberPrefix: "私についてこれを覚えておいてください：", forgetPrefix: "私についてこれを忘れてください：", preferencePrefix: "私の好みは：", identityPrefix: "私の名前は：" },
  Korean: { rememberPrefix: "나에 대해 이것을 기억해 주세요:", forgetPrefix: "나에 대해 이것을 잊어 주세요:", preferencePrefix: "내가 선호하는 것은:", identityPrefix: "내 이름은:" },
  Vietnamese: { rememberPrefix: "Hãy nhớ điều này về tôi:", forgetPrefix: "Hãy quên điều này về tôi:", preferencePrefix: "Sở thích của tôi là:", identityPrefix: "Tên tôi là:" },
  Thai: { rememberPrefix: "จำสิ่งนี้เกี่ยวกับฉัน:", forgetPrefix: "ลืมสิ่งนี้เกี่ยวกับฉัน:", preferencePrefix: "ความชอบของฉันคือ:", identityPrefix: "ฉันชื่อ:" },
  Indonesian: { rememberPrefix: "Ingat ini tentang saya:", forgetPrefix: "Lupakan ini tentang saya:", preferencePrefix: "Preferensi saya adalah:", identityPrefix: "Nama saya adalah:" },
  Malay: { rememberPrefix: "Ingat ini tentang saya:", forgetPrefix: "Lupakan ini tentang saya:", preferencePrefix: "Keutamaan saya ialah:", identityPrefix: "Nama saya ialah:" },
  Filipino: { rememberPrefix: "Tandaan ito tungkol sa akin:", forgetPrefix: "Kalimutan ito tungkol sa akin:", preferencePrefix: "Ang aking kagustuhan ay:", identityPrefix: "Ang pangalan ko ay:" },
  Swahili: { rememberPrefix: "Kumbuka haya kunihusu:", forgetPrefix: "Sahau haya kunihusu:", preferencePrefix: "Upendeleo wangu ni:", identityPrefix: "Jina langu ni:" },
  Afrikaans: { rememberPrefix: "Onthou dit van my:", forgetPrefix: "Vergeet dit van my:", preferencePrefix: "My voorkeur is:", identityPrefix: "My naam is:" },
  Amharic: { rememberPrefix: "ስለ እኔ ይህን አስታውስ፦", forgetPrefix: "ስለ እኔ ይህን እርሳ፦", preferencePrefix: "ምርጫዬ፦", identityPrefix: "ስሜ፦" },
  Yoruba: { rememberPrefix: "Rántí èyí nípa mi:", forgetPrefix: "Gbàgbé èyí nípa mi:", preferencePrefix: "Àyànfẹ́ mi ni:", identityPrefix: "Orúkọ mi ni:" },
  Zulu: { rememberPrefix: "Khumbula lokhu ngami:", forgetPrefix: "Khohlwa lokhu ngami:", preferencePrefix: "Engikuthandayo yilokhu:", identityPrefix: "Igama lami ngu:" },
  Hausa: { rememberPrefix: "Ka tuna da wannan game da ni:", forgetPrefix: "Ka manta da wannan game da ni:", preferencePrefix: "Abin da na fi so shi ne:", identityPrefix: "Sunana shi ne:" },
  Somali: { rememberPrefix: "Tan iga xasuuso:", forgetPrefix: "Tan iga ilow:", preferencePrefix: "Doorbidkaygu waa:", identityPrefix: "Magacaygu waa:" },
  Norwegian: { rememberPrefix: "Husk dette om meg:", forgetPrefix: "Glem dette om meg:", preferencePrefix: "Min preferanse er:", identityPrefix: "Mitt navn er:" },
  Swedish: { rememberPrefix: "Kom ihåg detta om mig:", forgetPrefix: "Glöm detta om mig:", preferencePrefix: "Min preferens är:", identityPrefix: "Jag heter:" },
  Danish: { rememberPrefix: "Husk dette om mig:", forgetPrefix: "Glem dette om mig:", preferencePrefix: "Min præference er:", identityPrefix: "Mit navn er:" },
  Finnish: { rememberPrefix: "Muista tämä minusta:", forgetPrefix: "Unohda tämä minusta:", preferencePrefix: "Mieltymykseni on:", identityPrefix: "Nimeni on:" },
  Icelandic: { rememberPrefix: "Mundu þetta um mig:", forgetPrefix: "Gleymdu þessu um mig:", preferencePrefix: "Ég kýs:", identityPrefix: "Ég heiti:" },
  Irish: { rememberPrefix: "Cuimhnigh seo fúm:", forgetPrefix: "Déan dearmad air seo fúm:", preferencePrefix: "Is é mo rogha:", identityPrefix: "Is é m'ainm:" },
  Welsh: { rememberPrefix: "Cofiwch hyn amdanaf i:", forgetPrefix: "Anghofiwch hyn amdanaf i:", preferencePrefix: "Fy hoffter yw:", identityPrefix: "Fy enw i yw:" },
  Catalan: { rememberPrefix: "Recorda això de mi:", forgetPrefix: "Oblida això de mi:", preferencePrefix: "La meva preferència és:", identityPrefix: "El meu nom és:" },
  Basque: { rememberPrefix: "Gogoratu hau niri buruz:", forgetPrefix: "Ahaztu hau nitaz:", preferencePrefix: "Nire hobespena hau da:", identityPrefix: "Nire izena da:" },
  Galician: { rememberPrefix: "Lembra isto de min:", forgetPrefix: "Esquece isto de min:", preferencePrefix: "A miña preferencia é:", identityPrefix: "O meu nome é:" },
  Serbian: { rememberPrefix: "Запамти ово о мени:", forgetPrefix: "Заборави ово о мени:", preferencePrefix: "Моја преференција је:", identityPrefix: "Моје име је:" },
  Croatian: { rememberPrefix: "Zapamti ovo o meni:", forgetPrefix: "Zaboravi ovo o meni:", preferencePrefix: "Moja preferencija je:", identityPrefix: "Moje ime je:" },
  Bosnian: { rememberPrefix: "Zapamti ovo o meni:", forgetPrefix: "Zaboravi ovo o meni:", preferencePrefix: "Moja preferencija je:", identityPrefix: "Moje ime je:" },
  Bulgarian: { rememberPrefix: "Запомни това за мен:", forgetPrefix: "Забрави това за мен:", preferencePrefix: "Моето предпочитание е:", identityPrefix: "Името ми е:" },
  Slovak: { rememberPrefix: "Zapamätaj si o mne toto:", forgetPrefix: "Zabudni toto o mne:", preferencePrefix: "Moja preferencia je:", identityPrefix: "Moje meno je:" },
  Slovenian: { rememberPrefix: "Zapomni si to o meni:", forgetPrefix: "Pozabi to o meni:", preferencePrefix: "Moja prednost je:", identityPrefix: "Moje ime je:" },
  Lithuanian: { rememberPrefix: "Prisimink tai apie mane:", forgetPrefix: "Pamiršk tai apie mane:", preferencePrefix: "Mano pirmenybė yra:", identityPrefix: "Mano vardas yra:" },
  Latvian: { rememberPrefix: "Atceries šo par mani:", forgetPrefix: "Aizmirsti šo par mani:", preferencePrefix: "Mana izvēle ir:", identityPrefix: "Mans vārds ir:" },
  Estonian: { rememberPrefix: "Pea seda minu kohta meeles:", forgetPrefix: "Unusta see minu kohta:", preferencePrefix: "Minu eelistus on:", identityPrefix: "Minu nimi on:" },
  Albanian: { rememberPrefix: "Mbaje mend këtë për mua:", forgetPrefix: "Harroje këtë për mua:", preferencePrefix: "Preferenca ime është:", identityPrefix: "Emri im është:" },
  Georgian: { rememberPrefix: "დაიმახსოვრე ეს ჩემ შესახებ:", forgetPrefix: "დაივიწყე ეს ჩემ შესახებ:", preferencePrefix: "ჩემი უპირატესობაა:", identityPrefix: "ჩემი სახელია:" },
  Armenian: { rememberPrefix: "Հիշիր սա իմ մասին:", forgetPrefix: "Մոռացիր սա իմ մասին:", preferencePrefix: "Իմ նախապատվությունն է:", identityPrefix: "Իմ անունն է:" },
  Azerbaijani: { rememberPrefix: "Mənim haqqımda bunu xatırla:", forgetPrefix: "Mənim haqqımda bunu unut:", preferencePrefix: "Üstünlük verdiyim:", identityPrefix: "Mənim adım:" },
};
const publicTopicMetadataKeys = new Set([
  "category",
  "uiMode",
  "modelProfile",
  "starters",
  "keywords",
  "source",
  "toolId",
]);

export type StateApiEnv = NativeSessionEnv & {
  MEMORY_POST_TURN_QUEUE?: Pick<CloudflareEnv["MEMORY_POST_TURN_QUEUE"], "send" | "sendBatch">;
  MEMORY_VECTORIZE?: CloudflareEnv["MEMORY_VECTORIZE"];
  APP_WRITE_FREEZE?: string;
  APP_WRITE_FREEZE_RETRY_AFTER_SECONDS?: string;
  WRITE_FREEZE?: string;
  RATE_LIMIT_MEMORY_DAILY?: string;
  CRON_SECRET?: string;
};

export type StateApiExecutionContext = Pick<ExecutionContext, "waitUntil">;

type JsonObject = Record<string, unknown>;

type TopicRow = {
  id: string;
  name: string;
};

type ChatRow = {
  id: string;
  userId: string | null;
  userEmailSnapshot: string | null;
  topicId: string | null;
  topicNameSnapshot: string | null;
  title: string | null;
  isArchived: number;
  createdAt: number;
  updatedAt: number;
};

type OwnedChatRow = ChatRow & {
  topicDbId: string | null;
  topicSlug: string | null;
  topicName: string | null;
  topicSubText: string | null;
  topicDescription: string | null;
  topicInputboxText: string | null;
  topicIconUrl: string | null;
  topicSortOrder: number | null;
  topicMetadata: unknown;
};

type RecentChatRow = {
  id: string;
  topicId: string | null;
  topicName: string | null;
  title: string | null;
  replyCount: number;
  firstMessagePreview: string | null;
  createdAt: number;
  updatedAt: number;
};

type MessageRow = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  metadata: unknown;
  createdAt: number;
  aiRunId: string | null;
  memoryContext: unknown;
};

type MessageContentRow = {
  content: string;
};

type ActivityRunRow = {
  id: string;
  chatId: string;
  type: string;
  status: string;
  state: unknown;
  score: number | null;
  maxScore: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

type MemorySettingsRow = {
  userId: string;
  enabled: number;
  savedMemoryEnabled: number;
  chatHistoryEnabled: number;
  dreamingEnabled: number;
  captureScope: string;
  retrievalMode: string;
  noticeSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type MemoryRow = {
  id: string;
  userId: string;
  kind: string;
  category: string;
  content: string;
  tags: unknown;
  confidence: number;
  salience: number;
  status: string;
  sourceType: string;
  sourceTurnIds: unknown;
  sourceMemoryIds: unknown;
  sourceChatId: string | null;
  sourceMessageId: string | null;
  embedding: unknown;
  validFrom: number | null;
  validUntil: number | null;
  freshnessStatus: string;
  pinned: number;
  doNotMention: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  deletedAt: number | null;
};

type MemoryProfileRow = {
  category: string;
  summary: string;
  updatedAt: number;
};

type MemorySummaryRow = {
  summary: string;
  sections: unknown;
  lastSynthesizedAt: number;
  updatedAt: number;
};

type MemorySummarySectionsRow = Pick<MemorySummaryRow, "sections">;

type VectorIdRow = { id: string };

type MemoryVectorIds = {
  memories: string[];
  summaries: string[];
  turns: string[];
};

type ReadJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string };

type QuotaDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

type MemoryPageCursor = {
  salience: number;
  updatedAt: number;
  id: string;
};

type ChatMessagePageCursor = {
  createdAt: number;
  id: string;
};

type NativeMemoryTopic = {
  id: string;
  name: string;
  slug: string;
};

type NativeMemoryPostTurnJob = {
  type: "memory.post_turn.v1" | "memory.post_turn.v2";
  aiRunId: string;
  userId: string;
  chatId: string;
  topic: NativeMemoryTopic;
  userMessageId: string;
  assistantMessageId: string;
};

type NativeMemoryDailyJob = {
  type: "memory.daily_synthesis.v1";
  userId: string;
  reason: string;
};

type NativeMemoryQueueJob = NativeMemoryPostTurnJob | NativeMemoryDailyJob;

type OwnedQueuedChatRow = {
  id: string;
  userId: string;
  topicId: string | null;
  topicName: string | null;
  topicSlug: string | null;
};

type QueuedMessageRow = {
  id: string;
  role: string;
  content: string;
};

type QueuedMemorySettingsRow = {
  userId: string;
  preferredLanguage: string;
  enabled: number;
  savedMemoryEnabled: number;
  chatHistoryEnabled: number;
  dreamingEnabled: number;
};

export type NativeMemoryIntentAction =
  | { type: "create"; category: "general" | "preferences" | "identity"; content: string }
  | { type: "forget"; query: string };

type ExistingTurnRow = { id: string };

type SynthesisMemoryRow = {
  id: string;
  category: string;
  content: string;
};

type SynthesisTurnRow = {
  id: string;
  question: string;
};

export type NativeSummarySection = {
  id: string;
  title: string;
  category: string;
  summary: string;
  sourceMemoryIds?: string[];
  sourceTurnIds?: string[];
  doNotMention?: boolean;
};

type DueSynthesisUserRow = { userId: string };

/**
 * Handles only the saved-state routes owned by this native module. Returning
 * null is an explicit signal that the caller should continue routing.
 */
export async function handleStateApiRequest(
  request: Request,
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!isStateApiPath(pathname)) return null;

  try {
    if (pathname === "/api/cron/memory-dreaming") {
      return handleMemoryCronRequest(request, env);
    }
    if (pathname === "/api/chats") return handleChats(request, env);
    const chatMessagePath = parseChatMessagePath(pathname);
    if (chatMessagePath) {
      return handleOwnedMessageContent(request, env, chatMessagePath);
    }
    const chatId = pathIdentifier(pathname, "/api/chats/");
    if (chatId !== null) return handleOwnedChat(request, env, ctx, chatId);

    if (pathname === "/api/memory") return handleMemory(request, env, ctx);
    if (pathname === "/api/memory/source-feedback") {
      return handleMemorySourceFeedback(request, env);
    }
    const memoryId = pathIdentifier(pathname, "/api/memory/");
    if (memoryId !== null) return handleMemoryItem(request, env, ctx, memoryId);

    if (pathname === "/api/analytics/events") return handleAnalyticsEvent(request, env, ctx);
    return null;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "native_state_api_failed",
        path: pathname,
        method: request.method,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return jsonResponse({ error: "The request could not be completed right now." }, 500);
  }
}

export function isStateApiPath(pathname: string) {
  return (
    pathname === "/api/chats" ||
    pathname.startsWith("/api/chats/") ||
    pathname === "/api/cron/memory-dreaming" ||
    pathname === "/api/memory" ||
    pathname.startsWith("/api/memory/") ||
    pathname === "/api/analytics/events"
  );
}

/**
 * Enqueues a small, bounded set of users whose memory summaries are stale.
 * All expensive synthesis from the OpenNext runtime is deliberately excluded:
 * the queue consumer below compiles deterministic D1 summaries instead.
 */
export async function handleMemoryScheduled(
  controller: ScheduledController,
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
): Promise<void> {
  if (isWriteFreezeEnabled(env)) {
    console.warn(
      JSON.stringify({
        event: "native_memory_scheduled_skipped",
        reason: "write_freeze_active",
        cron: controller.cron.slice(0, 80),
      }),
    );
    return;
  }

  const stats = await enqueueDueNativeMemorySynthesis(env, {
    limit: maxDailySynthesisUsers,
    enqueuedAt: controller.scheduledTime,
    reason: "daily_cron",
  });

  ctx.waitUntil(
    pruneNativeRateLimitWindows(env, controller.scheduledTime)
      .then(() => undefined)
      .catch((error) => {
        console.warn(
          JSON.stringify({
            event: "native_rate_limit_cleanup_failed",
            error: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }),
  );

  ctx.waitUntil(
    refreshNativeAdminTotals(env.DB, controller.scheduledTime)
      .then(() => undefined)
      .catch((error) => {
        console.warn(
          JSON.stringify({
            event: "native_admin_totals_refresh_failed",
            error: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }),
  );

  ctx.waitUntil(
    failStaleNativeAiRuns(env, controller.scheduledTime)
      .then(() => undefined)
      .catch((error) => {
        console.warn(
          JSON.stringify({
            event: "native_stale_ai_run_cleanup_failed",
            error: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }),
  );

  console.log(
    JSON.stringify({
      event: "native_memory_scheduled_enqueued",
      ...stats,
      cron: controller.cron.slice(0, 80),
    }),
  );
}

export async function handleMemoryCronRequest(request: Request, env: StateApiEnv) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  const secret = env.CRON_SECRET?.trim();
  if (!secret || secret.length > 256 || !(await timingSafeCronBearerEquals(request.headers.get("authorization"), secret))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const freeze = writeFreezeResponse(env, "cron-memory-dreaming");
  if (freeze) return freeze;

  const url = new URL(request.url);
  const limit = boundedMemoryCronLimit(url.searchParams.get("limit"));
  const now = Date.now();
  const [stats, rateLimitPrune] = await Promise.all([
    enqueueDueNativeMemorySynthesis(env, {
      limit,
      enqueuedAt: now,
      reason: "manual_cron",
    }),
    pruneNativeRateLimitWindows(env, now),
  ]);
  return jsonResponse(
    { ...stats, rateLimitPrune },
    stats.skipped === "missing_queue_binding" ? 503 : 200,
  );
}

async function enqueueDueNativeMemorySynthesis(
  env: StateApiEnv,
  input: { limit: number; enqueuedAt: number; reason: "daily_cron" | "manual_cron" },
) {
  const queue = env.MEMORY_POST_TURN_QUEUE;
  if (!queue) {
    return { due: 0, queued: 0, failed: 0, skipped: "missing_queue_binding" as const };
  }
  const due = await env.DB.prepare(
    `select distinct settings.user_id as userId
     from user_memory_settings settings
     left join user_memory_summaries summaries on summaries.user_id = settings.user_id
     where settings.enabled = 1
       and settings.saved_memory_enabled = 1
       and settings.dreaming_enabled = 1
       and (
         summaries.user_id is null
         or exists (
           select 1 from user_memories memories
           where memories.user_id = settings.user_id
             and memories.status = 'active'
             and memories.updated_at > summaries.last_synthesized_at
         )
         or (
           settings.chat_history_enabled = 1
           and exists (
             select 1 from chat_memory_turns turns
             where turns.user_id = settings.user_id
               and turns.updated_at > summaries.last_synthesized_at
           )
         )
       )
     order by settings.user_id
     limit ?1`,
  )
    .bind(Math.min(maxDailySynthesisUsers, Math.max(1, Math.trunc(input.limit))))
    .all<DueSynthesisUserRow>();

  if (due.results.length) {
    const enqueuedAt = new Date(input.enqueuedAt).toISOString();
    await queue.sendBatch(
      due.results.map((row) => ({
        body: {
          type: "memory.daily_synthesis.v1" as const,
          enqueuedAt,
          userId: row.userId,
          reason: input.reason,
        },
        contentType: "json" as const,
      })),
    );
  }
  return { due: due.results.length, queued: due.results.length, failed: 0, skipped: null };
}

async function pruneNativeRateLimitWindows(env: StateApiEnv, now: number) {
  const result = await env.DB.prepare(
    `delete from rate_limit_windows
     where "key" in (
       select "key" from rate_limit_windows
       where reset_at <= ?1
       order by reset_at asc
       limit ${MAX_RATE_LIMIT_PRUNE_ROWS}
     )`,
  )
    .bind(now)
    .run();
  return { pruned: result.meta.changes, cappedAt: MAX_RATE_LIMIT_PRUNE_ROWS };
}

async function failStaleNativeAiRuns(env: StateApiEnv, now: number) {
  const staleBefore = now - oneHourMs;
  const result = await env.DB.prepare(
    `update ai_runs
     set status = 'failed', error = 'client_finalize_timeout', completed_at = ?2
     where id in (
       select id from ai_runs
       where status = 'started' and created_at <= ?1
       order by created_at asc
       limit ${MAX_STALE_AI_RUN_REPAIRS}
     )`,
  )
    .bind(staleBefore, now)
    .run();
  return { repaired: result.meta.changes, cappedAt: MAX_STALE_AI_RUN_REPAIRS };
}

function boundedMemoryCronLimit(value: string | null) {
  if (!value || !/^\d{1,3}$/.test(value)) return 10;
  return Math.min(maxDailySynthesisUsers, Math.max(1, Number(value)));
}

function timingSafeCronBearerEquals(authorization: string | null, secret: string) {
  if ((authorization?.length ?? 0) > 512) return false;
  const encoder = new TextEncoder();
  const actual = encoder.encode(authorization ?? "");
  const expected = encoder.encode(`Bearer ${secret}`);
  const actualPadded = new Uint8Array(512);
  const expectedPadded = new Uint8Array(512);
  actualPadded.set(actual);
  expectedPadded.set(expected);
  return actual.length === expected.length && timingSafeBytesEqual(
    actualPadded,
    expectedPadded,
  );
}

function timingSafeBytesEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Processes memory jobs without importing zod, the AI SDK, OpenNext, or an
 * LLM. Invalid or stale messages are acknowledged; transient D1 failures are
 * retried with a bounded delay.
 */
export async function handleMemoryQueue(
  batch: MessageBatch<unknown>,
  env: StateApiEnv,
  _ctx: StateApiExecutionContext,
): Promise<void> {
  void _ctx;
  if (isWriteFreezeEnabled(env)) {
    batch.retryAll({ delaySeconds: writeFreezeRetrySeconds(env) });
    console.warn(
      JSON.stringify({
        event: "native_memory_queue_deferred",
        reason: "write_freeze_active",
        count: batch.messages.length,
      }),
    );
    return;
  }

  for (const message of batch.messages) {
    const job = parseNativeMemoryQueueJob(message.body);
    if (!job) {
      message.ack();
      console.warn(
        JSON.stringify({
          event: "native_memory_queue_invalid_message",
          messageId: message.id,
        }),
      );
      continue;
    }

    try {
      const outcome =
        job.type === "memory.daily_synthesis.v1"
          ? await synthesizeNativeUserMemory(env, job)
          : await processNativePostTurn(env, job);
      message.ack();
      console.log(
        JSON.stringify({
          event: "native_memory_queue_processed",
          type: job.type,
          userId: job.userId,
          messageId: message.id,
          attempts: message.attempts,
          outcome,
        }),
      );
    } catch (error) {
      const delaySeconds = Math.min(15 * 60, Math.max(30, message.attempts * 30));
      message.retry({ delaySeconds });
      console.warn(
        JSON.stringify({
          event: "native_memory_queue_failed",
          type: job.type,
          userId: job.userId,
          messageId: message.id,
          attempts: message.attempts,
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }
  }
}

async function processNativePostTurn(env: StateApiEnv, job: NativeMemoryPostTurnJob) {
  const [ownedChat, settings] = await Promise.all([
    env.DB.prepare(
      `select
         c.id,
         c.user_id as userId,
         c.topic_id as topicId,
         t.name as topicName,
         t.slug as topicSlug
       from chats c
       left join topics t on t.id = c.topic_id
       where c.id = ?1 and c.user_id = ?2
       limit 1`,
    )
      .bind(job.chatId, job.userId)
      .first<OwnedQueuedChatRow>(),
    loadQueuedMemorySettings(env, job.userId),
  ]);
  if (!ownedChat || !settings) return "stale_job";
  if (!toBoolean(settings.enabled)) return "memory_disabled";

  const messages = await env.DB.prepare(
    `select id, role,
       substr(
         content,
         1,
         case
           when role = 'user' then ${MAX_QUEUED_USER_MESSAGE_READ_CHARS}
           else ${MAX_QUEUED_ASSISTANT_MESSAGE_READ_CHARS}
         end
       ) as content
     from messages
     where chat_id = ?1 and id in (?2, ?3)`,
  )
    .bind(job.chatId, job.userMessageId, job.assistantMessageId)
    .all<QueuedMessageRow>();
  const byId = new Map(messages.results.map((row) => [row.id, row]));
  const userMessage = byId.get(job.userMessageId);
  const assistantMessage = byId.get(job.assistantMessageId);
  if (userMessage?.role !== "user" || assistantMessage?.role !== "assistant") return "stale_job";

  const chatHistoryEnabled = toBoolean(settings.chatHistoryEnabled);
  const savedMemoryEnabled = toBoolean(settings.savedMemoryEnabled);
  const existingTurn = chatHistoryEnabled
    ? await env.DB.prepare(
        `select id from chat_memory_turns
         where user_message_id = ?1 and user_id = ?2 and chat_id = ?3
         limit 1`,
      )
        .bind(job.userMessageId, job.userId, job.chatId)
        .first<ExistingTurnRow>()
    : null;
  const memoryAction = savedMemoryEnabled
    ? extractNativeMemoryIntentAction(userMessage.content, settings.preferredLanguage)
    : null;
  const existingMemory = memoryAction?.type === "create"
    ? await env.DB.prepare(
        `select id from user_memories
         where user_id = ?1 and status = 'active'
           and lower(content) = lower(?2)
         limit 1`,
      )
        .bind(job.userId, memoryAction.content)
        .first<{ id: string }>()
    : null;

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const turnId = existingTurn?.id ?? crypto.randomUUID();
  const topicName = boundedQueueText(ownedChat.topicName ?? job.topic.name, 120);
  const topicSlug = boundedQueueText(ownedChat.topicSlug ?? job.topic.slug, 120);
  const topicTags = uniqueStrings([topicSlug, topicName].filter(Boolean), 4);
  const question = boundedQueueText(visibleMessageContent(userMessage.content), 2_000);
  const answerExcerpt = boundedQueueText(assistantMessage.content, 1_000);
  const shouldStoreTurn = Boolean(
    chatHistoryEnabled && !existingTurn && question && answerExcerpt,
  );

  if (shouldStoreTurn) {
    statements.push(
      env.DB.prepare(
        `insert into chat_memory_turns (
           id, user_id, chat_id, topic_id, user_message_id,
           assistant_message_id, question, answer_excerpt,
           searchable_text, topics, embedding, created_at, updated_at
         ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, null, ?11, ?11)
         on conflict(user_message_id) do nothing`,
      ).bind(
        turnId,
        job.userId,
        job.chatId,
        ownedChat.topicId,
        job.userMessageId,
        job.assistantMessageId,
        question,
        answerExcerpt,
        boundedQueueText(`${question}\n${answerExcerpt}`, 3_200),
        JSON.stringify(topicTags),
        now,
      ),
      env.DB.prepare(
        `insert into chat_memory_summaries (
           chat_id, user_id, topic_id, summary, topics,
           source_message_count, last_message_id, embedding,
           created_at, updated_at
         ) values (
           ?1, ?2, ?3, ?4, ?5,
           (select count(*) from (
              select 1 from messages
              where chat_id = ?1
              order by created_at desc
              limit ${MAX_MEMORY_SUMMARY_MESSAGE_COUNT}
            )),
           ?6, null, ?7, ?7
         )
         on conflict(chat_id) do update set
           topic_id = excluded.topic_id,
           summary = excluded.summary,
           topics = excluded.topics,
           source_message_count = min(
             chat_memory_summaries.source_message_count + 2,
             ${MAX_MEMORY_SUMMARY_MESSAGE_COUNT}
           ),
           last_message_id = excluded.last_message_id,
           embedding = null,
           updated_at = excluded.updated_at
         where chat_memory_summaries.user_id = excluded.user_id`,
      ).bind(
        job.chatId,
        job.userId,
        ownedChat.topicId,
        boundedQueueText(`Question: ${question} Answer: ${answerExcerpt}`, 2_000),
        JSON.stringify(topicTags),
        job.assistantMessageId,
        now,
      ),
      memoryEventStatement(env, {
        userId: job.userId,
        chatId: job.chatId,
        messageId: job.userMessageId,
        eventType: "chat_turn_indexed",
        metadata: { turnId, runtime: NATIVE_STATE_API_DELIVERY },
        now,
      }),
    );
  }

  if (memoryAction?.type === "create" && !existingMemory) {
    const memoryId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        `insert into user_memories (
           id, user_id, kind, category, content, tags,
           confidence, salience, status, source_type,
           source_turn_ids, source_memory_ids, source_chat_id,
           source_message_id, embedding, freshness_status,
           pinned, do_not_mention, created_at, updated_at
         ) values (
           ?1, ?2, 'explicit', ?3, ?4, ?5,
           95, 90, 'active', 'prior_chat', ?6, '[]', ?7,
           ?8, null, 'current', 0, 0, ?9, ?9
         )`,
      ).bind(
        memoryId,
        job.userId,
        memoryAction.category,
        memoryAction.content,
        JSON.stringify(["prior_chat", "explicit"]),
        JSON.stringify(existingTurn ? [existingTurn.id] : shouldStoreTurn ? [turnId] : []),
        job.chatId,
        job.userMessageId,
        now,
      ),
      memoryEventStatement(env, {
        userId: job.userId,
        memoryId,
        chatId: job.chatId,
        messageId: job.userMessageId,
        eventType: "created",
        reason: "explicit_chat_request",
        metadata: { category: memoryAction.category, kind: "explicit" },
        now,
      }),
    );
  }

  if (memoryAction?.type === "forget") {
    statements.push(
      env.DB.prepare(
        `update user_memories
         set status = 'deleted', deleted_at = ?1, updated_at = ?1
         where user_id = ?2
           and id in (
             select id from user_memories
             where user_id = ?2 and status = 'active'
               and (
                 content = ?3 collate nocase
                 or instr(content, ?3) > 0
               )
             order by pinned desc, salience desc, updated_at desc
             limit 10
           )`,
      ).bind(now, job.userId, memoryAction.query),
      memoryEventStatement(env, {
        userId: job.userId,
        chatId: job.chatId,
        messageId: job.userMessageId,
        eventType: "deleted",
        reason: "explicit_chat_forget_request",
        metadata: { queryLength: memoryAction.query.length, maxMatches: 10 },
        now,
      }),
    );
  }

  if (!statements.length) return "already_current";
  await env.DB.batch(statements);
  return "stored";
}

async function synthesizeNativeUserMemory(env: StateApiEnv, job: NativeMemoryDailyJob) {
  const settings = await loadQueuedMemorySettings(env, job.userId);
  if (!settings) return "stale_job";
  if (!toBoolean(settings.enabled) || !toBoolean(settings.savedMemoryEnabled)) {
    return "memory_disabled";
  }
  if (job.reason === "daily_cron" && !toBoolean(settings.dreamingEnabled)) {
    return "dreaming_disabled";
  }

  const turnsPromise: Promise<{ results: SynthesisTurnRow[] }> = toBoolean(
    settings.chatHistoryEnabled,
  )
    ? env.DB.prepare(
        `select id, substr(question, 1, 2001) as question
         from chat_memory_turns
         where user_id = ?1
         order by updated_at desc
         limit ${maxSynthesisTurns}`,
      )
        .bind(job.userId)
        .all<SynthesisTurnRow>()
    : Promise.resolve({ results: [] });
  const [memories, turns, existingSummary] = await Promise.all([
    env.DB.prepare(
      `select id, category, substr(content, 1, 601) as content
       from user_memories
       where user_id = ?1 and status = 'active' and do_not_mention = 0
       order by pinned desc, salience desc, updated_at desc
       limit ${maxSynthesisMemories}`,
    )
      .bind(job.userId)
      .all<SynthesisMemoryRow>(),
    turnsPromise,
    env.DB.prepare(NATIVE_BOUNDED_MEMORY_SECTIONS_SQL)
      .bind(job.userId)
      .first<MemorySummarySectionsRow>(),
  ]);

  const priorSections = existingSummary
    ? parseRewritableBoundedMemorySummarySections(existingSummary.sections)
    : [];
  if (priorSections === null) {
    console.warn(
      JSON.stringify({
        event: "native_memory_synthesis_skipped",
        userId: job.userId,
        reason: "legacy_summary_sections_unreadable",
      }),
    );
    return "legacy_summary_sections_unreadable";
  }
  const hiddenCategories = new Set(
    priorSections
      .filter((section) => section.doNotMention === true)
      .flatMap((section) => {
        const category = boundedTrimmedString(section.category, 1, 60);
        return category ? [category] : [];
      }),
  );
  const hiddenSectionIds = new Set(
    priorSections
      .filter((section) => section.doNotMention === true)
      .flatMap((section) => {
        const id = boundedTrimmedString(section.id, 1, 120);
        return id ? [id] : [];
      }),
  );

  const byCategory = new Map<string, SynthesisMemoryRow[]>();
  for (const memory of memories.results) {
    const category = memoryCategories.has(memory.category) ? memory.category : "general";
    const existing = byCategory.get(category) ?? [];
    if (existing.length < 5) existing.push(memory);
    byCategory.set(category, existing);
  }

  const sections: NativeSummarySection[] = [];
  const orderedCategories = [...byCategory.keys()].sort();
  for (const category of orderedCategories) {
    const categoryMemories = byCategory.get(category) ?? [];
    const id = `native-memory-${category}`;
    const summary = boundedQueueText(
      categoryMemories
        .map((memory) => displayMemoryContent(memory.content))
        .filter(Boolean)
        .join(" "),
      1_200,
    );
    if (!summary) continue;
    const hidden = hiddenCategories.has(category) || hiddenSectionIds.has(id);
    sections.push({
      id,
      title: memoryCategoryTitle(category),
      category,
      summary,
      sourceMemoryIds: categoryMemories.map((memory) => memory.id),
      ...(hidden ? { doNotMention: true } : {}),
    });
  }

  const recentTurns = turns.results
    .map((turn) => ({
      id: turn.id,
      question: boundedQueueText(visibleMessageContent(turn.question), 240),
    }))
    .filter((turn) => Boolean(turn.question));
  if (recentTurns.length) {
    const id = "native-recent-learning";
    const hidden = hiddenCategories.has("interaction") || hiddenSectionIds.has(id);
    sections.push({
      id,
      title: "Recent learning context",
      category: "interaction",
      summary: boundedQueueText(
        `Recent questions: ${recentTurns
          .slice(0, 5)
          .map((turn) => turn.question)
          .join(" · ")}`,
        1_200,
      ),
      sourceTurnIds: recentTurns.map((turn) => turn.id),
      ...(hidden ? { doNotMention: true } : {}),
    });
  }

  const visibleSections = sections.filter((section) => !section.doNotMention);
  const summary = boundedQueueText(
    visibleSections.map((section) => `${section.title}: ${section.summary}`).join("\n"),
    4_000,
  );
  const sourceMemoryIds = uniqueStrings(
    sections.flatMap((section) => section.sourceMemoryIds ?? []),
    maxSynthesisMemories,
  );
  const sourceTurnIds = uniqueStrings(
    sections.flatMap((section) => section.sourceTurnIds ?? []),
    maxSynthesisTurns,
  );
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("delete from user_memory_profiles where user_id = ?1").bind(job.userId),
  ];
  for (const section of visibleSections.filter((value) => value.sourceMemoryIds?.length)) {
    statements.push(
      env.DB.prepare(
        `insert into user_memory_profiles (
           user_id, category, summary, source_memory_ids,
           last_compiled_at, created_at, updated_at
         ) values (?1, ?2, ?3, ?4, ?5, ?5, ?5)
         on conflict(user_id, category) do update set
           summary = excluded.summary,
           source_memory_ids = excluded.source_memory_ids,
           last_compiled_at = excluded.last_compiled_at,
           updated_at = excluded.updated_at`,
      ).bind(
        job.userId,
        section.category,
        section.summary,
        JSON.stringify(section.sourceMemoryIds ?? []),
        now,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      `insert into user_memory_summaries (
         user_id, summary, sections, source_memory_ids,
         source_turn_ids, version, last_synthesized_at,
         created_at, updated_at
       ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?6)
       on conflict(user_id) do update set
         summary = excluded.summary,
         sections = excluded.sections,
         source_memory_ids = excluded.source_memory_ids,
         source_turn_ids = excluded.source_turn_ids,
         version = user_memory_summaries.version + 1,
         last_synthesized_at = excluded.last_synthesized_at,
         updated_at = excluded.updated_at`,
    ).bind(
      job.userId,
      summary,
      JSON.stringify(sections),
      JSON.stringify(sourceMemoryIds),
      JSON.stringify(sourceTurnIds),
      now,
    ),
    env.DB.prepare(
      `insert into memory_synthesis_runs (
         id, user_id, reason, status, input_counts,
         output_counts, error, started_at, finished_at, created_at
       ) values (?1, ?2, ?3, 'completed', ?4, ?5, null, ?6, ?6, ?6)`,
    ).bind(
      crypto.randomUUID(),
      job.userId,
      job.reason,
      JSON.stringify({ memories: memories.results.length, turns: turns.results.length }),
      JSON.stringify({ sections: sections.length, profiles: statements.length - 1 }),
      now,
    ),
    memoryEventStatement(env, {
      userId: job.userId,
      eventType: "synthesized",
      reason: job.reason,
      metadata: {
        memories: memories.results.length,
        turns: turns.results.length,
        sections: sections.length,
        runtime: NATIVE_STATE_API_DELIVERY,
      },
      now,
    }),
  );
  await env.DB.batch(statements);
  return "synthesized";
}

async function loadQueuedMemorySettings(env: StateApiEnv, userId: string) {
  return env.DB.prepare(
    `select
       users.id as userId,
       substr(users.preferred_language, 1, 61) as preferredLanguage,
       coalesce(settings.enabled, 1) as enabled,
       coalesce(settings.saved_memory_enabled, 1) as savedMemoryEnabled,
       coalesce(settings.chat_history_enabled, 1) as chatHistoryEnabled,
       coalesce(settings.dreaming_enabled, 1) as dreamingEnabled
     from users
     left join user_memory_settings settings on settings.user_id = users.id
     where users.id = ?1
     limit 1`,
  )
    .bind(userId)
    .first<QueuedMemorySettingsRow>();
}

function parseNativeMemoryQueueJob(value: unknown): NativeMemoryQueueJob | null {
  if (!isRecord(value) || !validQueueTimestamp(value.enqueuedAt)) return null;
  const userId = boundedTrimmedString(value.userId, 1, 120);
  if (!userId) return null;

  if (value.type === "memory.daily_synthesis.v1") {
    const reason = boundedTrimmedString(value.reason, 1, 80);
    return reason ? { type: value.type, userId, reason } : null;
  }

  if (value.type !== "memory.post_turn.v1" && value.type !== "memory.post_turn.v2") return null;
  const aiRunId = boundedTrimmedString(value.aiRunId, 1, 120);
  const chatId = boundedTrimmedString(value.chatId, 1, 120);
  const topic = parseNativeMemoryTopic(value.topic);
  if (!aiRunId || !chatId || !topic) return null;

  if (value.type === "memory.post_turn.v2") {
    const userMessageId = boundedTrimmedString(value.userMessageId, 1, 120);
    const assistantMessageId = boundedTrimmedString(value.assistantMessageId, 1, 120);
    if (!userMessageId || !assistantMessageId || !validQueueIdList(value.contextMessageIds)) return null;
    return { type: value.type, aiRunId, userId, chatId, topic, userMessageId, assistantMessageId };
  }

  const userMessage = parseQueuedPersistedMessage(value.userMessage, "user");
  const assistantMessage = parseQueuedPersistedMessage(value.assistantMessage, "assistant");
  if (!userMessage || !assistantMessage || !validQueuedContextMessages(value.contextMessages)) return null;
  return {
    type: value.type,
    aiRunId,
    userId,
    chatId,
    topic,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
  };
}

function parseNativeMemoryTopic(value: unknown): NativeMemoryTopic | null {
  if (!isRecord(value)) return null;
  const id = boundedTrimmedString(value.id, 1, 120);
  const name = boundedTrimmedString(value.name, 1, 240);
  const slug = boundedTrimmedString(value.slug, 1, 240);
  return id && name && slug ? { id, name, slug } : null;
}

function parseQueuedPersistedMessage(value: unknown, role: "user" | "assistant") {
  if (!isRecord(value) || value.role !== role) return null;
  const id = boundedTrimmedString(value.id, 1, 120);
  if (!id || typeof value.content !== "string" || value.content.length > 120_000) return null;
  return { id };
}

function validQueueIdList(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 40 &&
    value.every((entry) => boundedTrimmedString(entry, 1, 120) !== null)
  );
}

function validQueuedContextMessages(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 40 &&
    value.every((entry) => {
      if (!isRecord(entry)) return false;
      const id = boundedTrimmedString(entry.id, 1, 120);
      const role = boundedTrimmedString(entry.role, 1, 40);
      return Boolean(id && role && typeof entry.content === "string" && entry.content.length <= 120_000);
    })
  );
}

function validQueueTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return false;
  return Number.isFinite(Date.parse(value));
}

export function extractNativeMemoryIntentAction(
  content: string,
  preferredLanguage: unknown,
): NativeMemoryIntentAction | null {
  const visible = visibleMessageContent(content);
  if (!visible || visible.length > 1_200) return null;
  const normalized = visible.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized) return null;

  const language = normalizeLanguage(preferredLanguage);
  const locale = languageConfigs[language].locale;
  const folded = normalized.toLocaleLowerCase(locale);
  const lexicon = memoryIntentLexicons[language];
  const localizedActions = [
    { prefix: lexicon.forgetPrefix, type: "forget" as const, category: "general" as const },
    { prefix: lexicon.preferencePrefix, type: "create" as const, category: "preferences" as const },
    { prefix: lexicon.identityPrefix, type: "create" as const, category: "identity" as const },
    { prefix: lexicon.rememberPrefix, type: "create" as const, category: "general" as const },
  ];
  for (const action of localizedActions) {
    const payload = payloadAfterMemoryPrefix(normalized, folded, action.prefix, locale);
    if (!payload) continue;
    return action.type === "forget"
      ? { type: "forget", query: payload }
      : { type: "create", category: action.category, content: payload };
  }

  const englishForget = normalized.match(/^(?:please\s+)?forget\s+that[\s:]+(.+)$/i)?.[1];
  const forgetPayload = normalizePersonalMemoryPayload(englishForget);
  if (forgetPayload) return { type: "forget", query: forgetPayload };

  const englishPreference = normalized.match(/^(?:my preference is|i prefer)[\s:]+(.+)$/i)?.[1];
  const preferencePayload = normalizePersonalMemoryPayload(englishPreference);
  if (preferencePayload) {
    return { type: "create", category: "preferences", content: preferencePayload };
  }

  const englishIdentity = normalized.match(/^my name is[\s:]+(.+)$/i)?.[1];
  const identityPayload = normalizePersonalMemoryPayload(englishIdentity);
  if (identityPayload) return { type: "create", category: "identity", content: identityPayload };

  const englishRemember = normalized.match(
    /^(?:(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:remember|remeber|rember|rememebr|remembr|remebr)\s+that|(?:please\s+)?keep in mind(?:\s+that)?)[\s:]+(.+)$/i,
  )?.[1];
  const rememberPayload = normalizePersonalMemoryPayload(englishRemember);
  return rememberPayload
    ? { type: "create", category: "general", content: rememberPayload }
    : null;
}

function payloadAfterMemoryPrefix(
  normalized: string,
  folded: string,
  prefix: string,
  locale: string,
) {
  const normalizedPrefix = prefix.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const foldedPrefix = normalizedPrefix.toLocaleLowerCase(locale);
  if (!folded.startsWith(foldedPrefix)) return null;
  return normalizePersonalMemoryPayload(normalized.slice(normalizedPrefix.length));
}

function normalizePersonalMemoryPayload(value: string | undefined) {
  if (!value) return null;
  const payload = value.replace(/^[\s:：;؛|.。፦-]+/u, "").replace(/\s+/gu, " ").trim();
  const length = Array.from(payload).length;
  return length >= 5 && length <= 600 && isUsefulMemoryContent(payload) ? payload : null;
}

function boundedQueueText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

function memoryCategoryTitle(category: string) {
  switch (category) {
    case "identity":
      return "About you";
    case "preferences":
      return "Preferences";
    case "learning_style":
      return "Learning style";
    case "projects":
      return "Projects";
    case "goals":
      return "Goals";
    case "knowledge":
      return "Knowledge";
    case "constraints":
      return "Constraints";
    case "interaction":
      return "Interaction preferences";
    default:
      return "Other details";
  }
}

function isWriteFreezeEnabled(env: StateApiEnv) {
  return truthyValues.has((env.APP_WRITE_FREEZE ?? env.WRITE_FREEZE ?? "").trim().toLowerCase());
}

function writeFreezeRetrySeconds(env: StateApiEnv) {
  return positiveInteger(
    env.APP_WRITE_FREEZE_RETRY_AFTER_SECONDS,
    defaultWriteFreezeRetrySeconds,
  );
}

async function handleChats(request: Request, env: StateApiEnv) {
  const session = await requireNativeSession(request, env);
  if (!session) return unauthorizedResponse();

  if (request.method === "GET") return listChats(request, env, session);
  if (request.method === "POST") return createChat(request, env, session);
  return methodNotAllowed(["GET", "POST"], session);
}

async function listChats(request: Request, env: StateApiEnv, session: NativeAuthenticatedSession) {
  const searchParams = new URL(request.url).searchParams;
  const topicIdentifier = boundedTrimmedString(searchParams.get("topicId"), 1, 120);
  const query = boundedTrimmedString(searchParams.get("q"), 1, 200);

  let topicId: string | null = null;
  if (topicIdentifier) {
    const topic = await env.DB.prepare(
      "select id from topics where id = ?1 or slug = lower(?1) limit 1",
    )
      .bind(topicIdentifier)
      .first<{ id: string }>();
    if (!topic) return jsonResponse({ chats: [] }, 200, session);
    topicId = topic.id;
  }

  const bindings: Array<string | number> = [session.user.id];
  let filters = "c.user_id = ?1 and c.is_archived = 0";
  if (topicId) {
    bindings.push(topicId);
    filters += ` and c.topic_id = ?${bindings.length}`;
  }
  const pattern = query ? containsLikePattern(query) : null;
  let searchFilter = "";
  if (pattern) {
    bindings.push(pattern);
    const parameter = `?${bindings.length}`;
    searchFilter = `where (
      lower(coalesce(c.title, '')) like lower(${parameter}) escape '\\'
      or lower(coalesce(c.topic_name_snapshot, '')) like lower(${parameter}) escape '\\'
      or exists (
        select 1
        from (
          select substr(recent.content, 1, ${MAX_CHAT_SEARCH_MESSAGE_CHARS}) as content
          from messages recent
          where recent.chat_id = c.id
          order by recent.created_at desc
          limit ${MAX_CHAT_SEARCH_MESSAGES_PER_CHAT}
        ) searched
        where lower(searched.content) like lower(${parameter}) escape '\\'
      )
    )`;
  }

  const result = await env.DB.prepare(
    `with candidate_chats as materialized (
       select
         c.id,
         c.topic_id,
         c.topic_name_snapshot,
         c.title,
         c.created_at,
         c.updated_at
       from chats c
       where ${filters}
       order by c.updated_at desc
       limit ${pattern ? MAX_CHAT_SEARCH_CANDIDATES : MAX_RECENT_CHAT_RESULTS}
     )
     select
       c.id,
       c.topic_id as topicId,
       c.topic_name_snapshot as topicName,
       c.title,
       c.created_at as createdAt,
       c.updated_at as updatedAt,
       (select count(*)
          from (
            select 1
            from messages counted
            where counted.chat_id = c.id
            order by counted.created_at desc
            limit ${MAX_CHAT_REPLY_COUNT_SCAN + 1}
          ) bounded_replies) as replyCount,
       (select substr(preview.content, 1, 400) from messages preview
          where preview.chat_id = c.id and preview.role = 'user'
          order by preview.created_at asc limit 1) as firstMessagePreview
     from candidate_chats c
     ${searchFilter}
     order by c.updated_at desc
     limit ${MAX_RECENT_CHAT_RESULTS}`,
  )
    .bind(...bindings)
    .all<RecentChatRow>();

  return jsonResponse(
    {
      chats: result.results.map((row) => ({
        id: row.id,
        topicId: row.topicId,
        topicName: row.topicName,
        title: row.title,
        firstMessagePreview:
          visibleMessageContent(row.firstMessagePreview ?? "") || row.title || row.topicName,
        replyCount: Math.min(finiteInteger(row.replyCount, 0), MAX_CHAT_REPLY_COUNT_SCAN),
        replyCountCapped: finiteInteger(row.replyCount, 0) > MAX_CHAT_REPLY_COUNT_SCAN,
        createdAt: isoTimestamp(row.createdAt),
        updatedAt: isoTimestamp(row.updatedAt),
      })),
    },
    200,
    session,
  );
}

async function createChat(request: Request, env: StateApiEnv, session: NativeAuthenticatedSession) {
  const freeze = writeFreezeResponse(env, "chats", session);
  if (freeze) return freeze;
  const json = await readBoundedJson(request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status, session);
  const topicIdentifier = isRecord(json.value)
    ? boundedTrimmedString(json.value.topicId, 1, 120)
    : null;
  if (!topicIdentifier) return jsonResponse({ error: "Invalid chat request" }, 400, session);

  const topic = await env.DB.prepare(
    "select id, name from topics where id = ?1 or slug = lower(?1) limit 1",
  )
    .bind(topicIdentifier)
    .first<TopicRow>();
  if (!topic) return jsonResponse({ error: "Topic not found" }, 404, session);

  const now = Date.now();
  const chatId = crypto.randomUUID();
  const chat = await env.DB.prepare(
    `insert into chats (
       id, user_id, topic_id, topic_name_snapshot, title,
       is_archived, created_at, updated_at
     ) values (?1, ?2, ?3, ?4, ?4, 0, ?5, ?5)
     returning
       id, user_id as userId, user_email_snapshot as userEmailSnapshot,
       topic_id as topicId, topic_name_snapshot as topicNameSnapshot,
       title, is_archived as isArchived,
       created_at as createdAt, updated_at as updatedAt`,
  )
    .bind(chatId, session.user.id, topic.id, topic.name, now)
    .first<ChatRow>();
  if (!chat || chat.userId !== session.user.id) {
    throw new Error("Native chat insert did not return the owned chat");
  }

  return jsonResponse(
    { chatId: chat.id, chat: serializeChat(chat) },
    200,
    session,
  );
}

async function handleOwnedChat(
  request: Request,
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
  rawChatId: string,
) {
  const session = await requireNativeSession(request, env);
  if (!session) return unauthorizedResponse();
  const chatId = decodedUuid(rawChatId);
  if (!chatId) return jsonResponse({ error: "Not found" }, 404, session);
  if (request.method === "DELETE") {
    return deleteOwnedChat(env, ctx, session, chatId);
  }
  if (request.method !== "GET") return methodNotAllowed(["GET", "DELETE"], session);

  const owned = await env.DB.prepare(
    `select
       c.id,
       c.user_id as userId,
       c.user_email_snapshot as userEmailSnapshot,
       c.topic_id as topicId,
       c.topic_name_snapshot as topicNameSnapshot,
       c.title,
       c.is_archived as isArchived,
       c.created_at as createdAt,
       c.updated_at as updatedAt,
       t.id as topicDbId,
       t.slug as topicSlug,
       t.name as topicName,
       t.sub_text as topicSubText,
       t.description as topicDescription,
       t.inputbox_text as topicInputboxText,
       t.icon_url as topicIconUrl,
       t.sort_order as topicSortOrder,
       substr(t.metadata, 1, 16384) as topicMetadata
     from chats c
     left join topics t on t.id = c.topic_id
     where c.id = ?1 and c.user_id = ?2
     limit 1`,
  )
    .bind(chatId, session.user.id)
    .first<OwnedChatRow>();
  if (!owned) return jsonResponse({ error: "Not found" }, 404, session);

  const rawMessageCursor = new URL(request.url).searchParams.get("messageCursor");
  const messageCursor = parseChatMessagePageCursor(rawMessageCursor);
  if (rawMessageCursor && !messageCursor) {
    return jsonResponse({ error: "Invalid message cursor" }, 400, session);
  }
  const messageBindings: Array<string | number> = [chatId];
  let messageCursorFilter = "";
  if (messageCursor) {
    messageBindings.push(messageCursor.createdAt, messageCursor.id);
    messageCursorFilter = `
           and (
             created_at < ?2
             or (created_at = ?2 and id < ?3)
           )`;
  }

  const [messagesResult, activityRun] = await Promise.all([
    env.DB.prepare(
      `with recent_messages as (
         select id, chat_id, role, content, metadata, created_at
         from messages
         where chat_id = ?1${messageCursorFilter}
         order by created_at desc, id desc
         limit ${maxSavedChatMessages + 1}
       )
       select
         m.id,
         m.chat_id as chatId,
         m.role,
         substr(m.content, 1, ${maxSavedMessageChars + 1}) as content,
         substr(m.metadata, 1, 2048) as metadata,
         m.created_at as createdAt,
         a.id as aiRunId,
         substr(a.memory_context, 1, 4096) as memoryContext
       from recent_messages m
       left join ai_runs a on a.assistant_message_id = m.id
       order by m.created_at asc, m.id asc`,
    )
      .bind(...messageBindings)
      .all<MessageRow>(),
    env.DB.prepare(
      `select
         id, chat_id as chatId, type, status,
         substr(state, 1, ${maxJsonColumnChars}) as state, score,
         max_score as maxScore, created_at as createdAt,
         updated_at as updatedAt, completed_at as completedAt
       from activity_runs
       where chat_id = ?1
       order by updated_at desc
       limit 1`,
    )
      .bind(chatId)
      .first<ActivityRunRow>(),
  ]);
  const hasMoreMessages = messagesResult.results.length > maxSavedChatMessages;
  const messageRows = hasMoreMessages
    ? messagesResult.results.slice(1)
    : messagesResult.results;
  const oldestMessage = hasMoreMessages ? messageRows[0] : undefined;

  return jsonResponse(
    {
      chat: serializeChat(owned),
      topic: serializeOwnedTopic(owned),
      messages: serializeBoundedMessages(messageRows),
      messagePage: {
        hasMore: hasMoreMessages,
        nextCursor: oldestMessage ? serializeChatMessagePageCursor(oldestMessage) : null,
        limit: maxSavedChatMessages,
      },
      activityRun: activityRun ? serializeActivityRun(activityRun) : null,
    },
    200,
    session,
  );
}

async function handleOwnedMessageContent(
  request: Request,
  env: StateApiEnv,
  path: { rawChatId: string; rawMessageId: string },
) {
  const session = await requireNativeSession(request, env);
  if (!session) return unauthorizedResponse();
  if (request.method !== "GET") return methodNotAllowed(["GET"], session);

  const chatId = decodedUuid(path.rawChatId);
  const messageId = decodedUuid(path.rawMessageId);
  if (!chatId || !messageId) return jsonResponse({ error: "Not found" }, 404, session);

  const rawOffset = new URL(request.url).searchParams.get("offset");
  const offset = parseMessageContentOffset(rawOffset);
  if (offset === null) {
    return jsonResponse({ error: "Invalid message offset" }, 400, session);
  }

  const row = await env.DB.prepare(
    `select substr(m.content, ?4, ${maxSavedMessageChars + 1}) as content
     from messages m
     inner join chats c on c.id = m.chat_id
     where c.id = ?1 and c.user_id = ?2
       and m.id = ?3 and m.chat_id = ?1
     limit 1`,
  )
    .bind(chatId, session.user.id, messageId, offset + 1)
    .first<MessageContentRow>();
  if (!row || typeof row.content !== "string") {
    return jsonResponse({ error: "Not found" }, 404, session);
  }

  const chunk = buildBoundedMessageContentChunk(row.content, offset);
  return jsonResponse(
    {
      chatId,
      messageId,
      offset,
      content: chunk.content,
      hasMore: chunk.hasMore,
      nextOffset: chunk.nextOffset,
    },
    200,
    session,
  );
}

async function deleteOwnedChat(
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
  session: NativeAuthenticatedSession,
  chatId: string,
) {
  const freeze = writeFreezeResponse(env, "chats", session);
  if (freeze) return freeze;

  const owned = await env.DB.prepare(
    "select id from chats where id = ?1 and user_id = ?2 limit 1",
  )
    .bind(chatId, session.user.id)
    .first<{ id: string }>();
  if (!owned) return jsonResponse({ error: "Not found" }, 404, session);

  const turns = env.MEMORY_VECTORIZE
    ? await env.DB.prepare(
        `select id from chat_memory_turns
         where chat_id = ?1 and user_id = ?2
         limit ${maxVectorCleanupRows}`,
      )
        .bind(chatId, session.user.id)
        .all<VectorIdRow>()
    : null;
  const deleted = await env.DB.prepare(
    `delete from chats
     where id = ?1 and user_id = ?2
     returning id`,
  )
    .bind(chatId, session.user.id)
    .first<{ id: string }>();
  if (!deleted) return jsonResponse({ error: "Not found" }, 404, session);

  scheduleVectorCleanup(ctx, env, {
    memories: [],
    summaries: [chatId],
    turns: turns?.results.map((row) => row.id) ?? [],
  });
  return jsonResponse({ ok: true }, 200, session);
}

async function handleMemory(
  request: Request,
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
) {
  const session = await requireNativeSession(request, env);
  if (!session) return unauthorizedResponse();

  if (request.method === "GET") {
    const rawCursor = new URL(request.url).searchParams.get("cursor");
    const cursor = parseMemoryPageCursor(rawCursor);
    if (rawCursor && !cursor) {
      return jsonResponse({ error: "Invalid memory cursor" }, 400, session);
    }
    return jsonResponse(await loadMemoryDashboard(env, session.user.id, cursor), 200, session);
  }
  if (request.method === "POST") return createMemory(request, env, ctx, session);
  if (request.method === "PATCH") return updateMemorySettings(request, env, ctx, session);
  if (request.method === "DELETE") return clearMemories(env, ctx, session);
  return methodNotAllowed(["GET", "POST", "PATCH", "DELETE"], session);
}

async function createMemory(
  request: Request,
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
  session: NativeAuthenticatedSession,
) {
  const freeze = writeFreezeResponse(env, "memory", session);
  if (freeze) return freeze;
  const json = await readBoundedJson(request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status, session);
  const parsed = parseMemoryCreate(json.value);
  if (!parsed || !isUsefulMemoryContent(parsed.content)) {
    return jsonResponse({ error: "That memory needs a little more detail." }, 400, session);
  }

  const settings = await loadMemorySettings(env, session.user.id);
  if (!toBoolean(settings.enabled)) {
    return jsonResponse({ error: "Memory is turned off." }, 409, session);
  }
  const quota = await consumeMemoryQuota(env, `memory:create:${session.user.id}`);
  if (!quota.ok) {
    return jsonResponse(
      { error: "Daily memory limit reached" },
      429,
      session,
      { "retry-after": String(quota.retryAfterSeconds) },
    );
  }

  const now = Date.now();
  const memoryId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `insert into user_memories (
         id, user_id, kind, category, content, tags, confidence,
         salience, status, source_type, source_turn_ids,
         source_memory_ids, freshness_status, pinned,
         do_not_mention, created_at, updated_at
       ) values (
         ?1, ?2, 'explicit', ?3, ?4, ?5, 100,
         95, 'active', 'manual', '[]', '[]', 'current', 1, 0, ?6, ?6
       )
       returning
         id, user_id as userId, kind, category, content, tags,
         confidence, salience, status, source_type as sourceType,
         source_turn_ids as sourceTurnIds,
         source_memory_ids as sourceMemoryIds,
         source_chat_id as sourceChatId,
         source_message_id as sourceMessageId,
         embedding, valid_from as validFrom, valid_until as validUntil,
         freshness_status as freshnessStatus, pinned,
         do_not_mention as doNotMention,
         created_at as createdAt, updated_at as updatedAt,
         last_used_at as lastUsedAt, deleted_at as deletedAt`,
    ).bind(memoryId, session.user.id, parsed.category, parsed.content, JSON.stringify(["manual"]), now),
    memoryEventStatement(env, {
      userId: session.user.id,
      memoryId,
      eventType: "created",
      metadata: { category: parsed.category, kind: "explicit" },
      now,
    }),
  ];
  const results = await env.DB.batch<MemoryRow>(statements);
  const memory = results[0]?.results[0];
  if (!memory) throw new Error("Native memory insert returned no row");

  if (!isDisposableValidationSession(session)) {
    scheduleMemorySynthesis(ctx, env, session.user.id, "manual_memory_created");
  }
  const incremental = { ok: true, memory: serializeMemory(memory) } as const;
  if (usesIncrementalStateContract(request)) {
    return jsonResponse(incremental, 201, session);
  }
  const dashboard = await loadMemoryDashboard(env, session.user.id);
  return jsonResponse({ ...dashboard, ...incremental }, 201, session);
}

async function updateMemorySettings(
  request: Request,
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
  session: NativeAuthenticatedSession,
) {
  const freeze = writeFreezeResponse(env, "memory", session);
  if (freeze) return freeze;
  const json = await readBoundedJson(request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status, session);
  const patch = parseMemorySettingsPatch(json.value);
  if (!patch) return jsonResponse({ error: "Invalid memory settings" }, 400, session);

  if (patch.refreshSummary || patch.correction) {
    const quota = await consumeMemoryQuota(env, `memory:update:${session.user.id}`);
    if (!quota.ok) {
      return jsonResponse(
        { error: "Daily memory limit reached" },
        429,
        session,
        { "retry-after": String(quota.retryAfterSeconds) },
      );
    }
  }

  const current = await loadMemorySettings(env, session.user.id);
  const now = Date.now();
  const next = {
    enabled: patch.enabled ?? toBoolean(current.enabled),
    savedMemoryEnabled: patch.savedMemoryEnabled ?? toBoolean(current.savedMemoryEnabled),
    chatHistoryEnabled: patch.chatHistoryEnabled ?? toBoolean(current.chatHistoryEnabled),
    dreamingEnabled: patch.dreamingEnabled ?? toBoolean(current.dreamingEnabled),
    captureScope: current.captureScope,
    retrievalMode: current.retrievalMode,
    noticeSeenAt: patch.noticeSeen ? now : current.noticeSeenAt,
  };
  const disablingChatHistory = toBoolean(current.chatHistoryEnabled) && !next.chatHistoryEnabled;
  const vectorIds = disablingChatHistory
    ? await loadMemoryVectorIds(env, session.user.id, { priorChatOnly: true })
    : null;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `insert into user_memory_settings (
         user_id, enabled, saved_memory_enabled, chat_history_enabled,
         dreaming_enabled, capture_scope, retrieval_mode,
         notice_seen_at, created_at, updated_at
       ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       on conflict(user_id) do update set
         enabled = excluded.enabled,
         saved_memory_enabled = excluded.saved_memory_enabled,
         chat_history_enabled = excluded.chat_history_enabled,
         dreaming_enabled = excluded.dreaming_enabled,
         capture_scope = excluded.capture_scope,
         retrieval_mode = excluded.retrieval_mode,
         notice_seen_at = excluded.notice_seen_at,
         updated_at = excluded.updated_at`,
    ).bind(
      session.user.id,
      next.enabled ? 1 : 0,
      next.savedMemoryEnabled ? 1 : 0,
      next.chatHistoryEnabled ? 1 : 0,
      next.dreamingEnabled ? 1 : 0,
      next.captureScope,
      next.retrievalMode,
      next.noticeSeenAt,
      now,
    ),
    memoryEventStatement(env, {
      userId: session.user.id,
      eventType: "settings_updated",
      metadata: patch,
      now,
    }),
  ];
  let correctionMemoryId: string | null = null;

  if (patch.correction) {
    const memoryId = crypto.randomUUID();
    correctionMemoryId = memoryId;
    statements.push(
      env.DB.prepare(
        `insert into user_memories (
           id, user_id, kind, category, content, tags, confidence,
           salience, status, source_type, source_turn_ids,
           source_memory_ids, freshness_status, pinned,
           do_not_mention, created_at, updated_at
         ) values (
           ?1, ?2, 'explicit', 'general', ?3, ?4, 100,
           95, 'active', 'manual', '[]', '[]', 'current', 1, 0, ?5, ?5
         )`,
      ).bind(memoryId, session.user.id, patch.correction, JSON.stringify(["manual", "correction"]), now),
      memoryEventStatement(env, {
        userId: session.user.id,
        memoryId,
        eventType: "created",
        metadata: { category: "general", kind: "explicit", correction: true },
        now,
      }),
    );
  }

  if (disablingChatHistory) {
    statements.push(
      env.DB.prepare(
        `update user_memories
         set status = 'deleted', deleted_at = ?1, updated_at = ?1
         where user_id = ?2 and status = 'active'
           and source_type in ('prior_chat', 'synthesized')`,
      ).bind(now, session.user.id),
      env.DB.prepare("delete from user_memory_summaries where user_id = ?1").bind(session.user.id),
      env.DB.prepare("delete from chat_memory_summaries where user_id = ?1").bind(session.user.id),
      env.DB.prepare("delete from chat_memory_turns where user_id = ?1").bind(session.user.id),
      memoryEventStatement(env, {
        userId: session.user.id,
        eventType: "cleared",
        reason: "chat_history_memory_disabled",
        now,
      }),
    );
  }

  await env.DB.batch(statements);
  if (vectorIds) scheduleVectorCleanup(ctx, env, vectorIds);
  if (patch.refreshSummary || patch.correction) {
    scheduleMemorySynthesis(
      ctx,
      env,
      session.user.id,
      patch.correction ? "user_correction" : "manual_refresh",
    );
  }
  const updatedSettings: MemorySettingsRow = {
    userId: session.user.id,
    enabled: next.enabled ? 1 : 0,
    savedMemoryEnabled: next.savedMemoryEnabled ? 1 : 0,
    chatHistoryEnabled: next.chatHistoryEnabled ? 1 : 0,
    dreamingEnabled: next.dreamingEnabled ? 1 : 0,
    captureScope: next.captureScope,
    retrievalMode: next.retrievalMode,
    noticeSeenAt: next.noticeSeenAt,
    createdAt: current.createdAt,
    updatedAt: now,
  };
  const incremental = {
    ok: true,
    settings: serializeMemorySettings(updatedSettings),
    ...(correctionMemoryId ? { correctionMemoryId } : {}),
  } as const;
  if (usesIncrementalStateContract(request)) {
    return jsonResponse(incremental, 200, session);
  }
  const dashboard = await loadMemoryDashboard(env, session.user.id);
  return jsonResponse({ ...dashboard, ...incremental }, 200, session);
}

export function usesIncrementalStateContract(request: Request) {
  return (
    request.headers.get(STATE_API_INCREMENTAL_CONTRACT_HEADER) ===
    STATE_API_INCREMENTAL_CONTRACT_VALUE
  );
}

async function clearMemories(
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
  session: NativeAuthenticatedSession,
) {
  const freeze = writeFreezeResponse(env, "memory", session);
  if (freeze) return freeze;
  const now = Date.now();
  const [settings, vectorIds] = await Promise.all([
    loadMemorySettings(env, session.user.id),
    loadMemoryVectorIds(env, session.user.id),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `update user_memories
       set status = 'deleted', deleted_at = ?1, updated_at = ?1
       where user_id = ?2 and status = 'active'`,
    ).bind(now, session.user.id),
    env.DB.prepare("delete from user_memory_profiles where user_id = ?1").bind(session.user.id),
    env.DB.prepare("delete from user_memory_summaries where user_id = ?1").bind(session.user.id),
    env.DB.prepare("delete from chat_memory_summaries where user_id = ?1").bind(session.user.id),
    env.DB.prepare("delete from chat_memory_turns where user_id = ?1").bind(session.user.id),
    memoryEventStatement(env, {
      userId: session.user.id,
      eventType: "cleared",
      now,
    }),
  ]);
  scheduleVectorCleanup(ctx, env, vectorIds);
  return jsonResponse(
    {
      settings: serializeMemorySettings(settings),
      summary: null,
      profiles: [],
      memories: [],
      memoryPage: { hasMore: false, nextCursor: null, limit: maxMemoryDashboardItems },
    },
    200,
    session,
  );
}

async function handleMemoryItem(
  request: Request,
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
  rawMemoryId: string,
) {
  const session = await requireNativeSession(request, env);
  if (!session) return unauthorizedResponse();
  const memoryId = decodedUuid(rawMemoryId);
  if (!memoryId) return jsonResponse({ error: "Memory not found" }, 404, session);
  if (request.method === "PATCH") return updateMemoryItem(request, env, ctx, session, memoryId);
  if (request.method === "DELETE") return deleteMemoryItem(env, ctx, session, memoryId);
  return methodNotAllowed(["PATCH", "DELETE"], session);
}

async function updateMemoryItem(
  request: Request,
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
  session: NativeAuthenticatedSession,
  memoryId: string,
) {
  const freeze = writeFreezeResponse(env, "memory", session);
  if (freeze) return freeze;
  const json = await readBoundedJson(request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status, session);
  const patch = parseMemoryItemPatch(json.value);
  if (!patch) return jsonResponse({ error: "Invalid memory update" }, 400, session);
  if (patch.content && !isUsefulMemoryContent(patch.content)) {
    return jsonResponse({ error: "That memory needs a little more detail." }, 400, session);
  }

  const existing = await getOwnedMemory(env, session.user.id, memoryId, true);
  if (!existing) return jsonResponse({ error: "Memory not found" }, 404, session);
  const currentTags = stringArray(existing.tags, 8, 32);
  const userEdited = patch.content !== undefined || patch.category !== undefined || patch.tags !== undefined;
  const nextTags = userEdited
    ? uniqueStrings([...(patch.tags ?? currentTags).filter((tag) => tag !== "prior_chat" && tag !== "chat_history"), "manual"], 8)
    : currentTags;
  const nextContent = patch.content ?? existing.content;
  const nextCategory = patch.category ?? existing.category;
  const nextPinned = patch.pinned ?? (userEdited ? true : toBoolean(existing.pinned));
  const nextDoNotMention = patch.doNotMention ?? toBoolean(existing.doNotMention);
  const nextEmbedding = patch.content !== undefined ? null : existing.embedding;
  const now = Date.now();
  const update = env.DB.prepare(
    `update user_memories set
       kind = ?1,
       category = ?2,
       content = ?3,
       tags = ?4,
       source_type = ?5,
       pinned = ?6,
       do_not_mention = ?7,
       salience = 90,
       embedding = ?8,
       updated_at = ?9
     where id = ?10 and user_id = ?11 and status = 'active'
     returning
       id, user_id as userId, kind, category, content, tags,
       confidence, salience, status, source_type as sourceType,
       source_turn_ids as sourceTurnIds,
       source_memory_ids as sourceMemoryIds,
       source_chat_id as sourceChatId,
       source_message_id as sourceMessageId,
       embedding, valid_from as validFrom, valid_until as validUntil,
       freshness_status as freshnessStatus, pinned,
       do_not_mention as doNotMention,
       created_at as createdAt, updated_at as updatedAt,
       last_used_at as lastUsedAt, deleted_at as deletedAt`,
  ).bind(
    userEdited ? "explicit" : existing.kind,
    nextCategory,
    nextContent,
    JSON.stringify(nextTags),
    userEdited ? "manual" : existing.sourceType,
    nextPinned ? 1 : 0,
    nextDoNotMention ? 1 : 0,
    serializeJsonColumn(nextEmbedding),
    now,
    memoryId,
    session.user.id,
  );
  const results = await env.DB.batch<MemoryRow>([
    update,
    memoryEventStatement(env, {
      userId: session.user.id,
      memoryId,
      eventType: "updated",
      metadata: { fields: Object.keys(patch) },
      now,
    }),
  ]);
  const memory = results[0]?.results[0];
  if (!memory) return jsonResponse({ error: "Memory not found" }, 404, session);

  if (patch.content !== undefined && !isDisposableValidationSession(session)) {
    scheduleVectorCleanup(ctx, env, { memories: [memoryId], summaries: [], turns: [] });
  }
  if (userEdited && !isDisposableValidationSession(session)) {
    scheduleMemorySynthesis(ctx, env, session.user.id, "manual_memory_updated");
  }
  return jsonResponse({ memory: serializeMemory(memory) }, 200, session);
}

async function deleteMemoryItem(
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
  session: NativeAuthenticatedSession,
  memoryId: string,
) {
  const freeze = writeFreezeResponse(env, "memory", session);
  if (freeze) return freeze;
  const existing = await getOwnedMemory(env, session.user.id, memoryId, false);
  if (!existing) return jsonResponse({ error: "Memory not found" }, 404, session);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `update user_memories
       set status = 'deleted', deleted_at = ?1, updated_at = ?1
       where id = ?2 and user_id = ?3`,
    ).bind(now, memoryId, session.user.id),
    memoryEventStatement(env, {
      userId: session.user.id,
      memoryId,
      eventType: "deleted",
      metadata: { fields: ["status", "deletedAt"] },
      now,
    }),
  ]);
  if (!isDisposableValidationSession(session)) {
    scheduleVectorCleanup(ctx, env, { memories: [memoryId], summaries: [], turns: [] });
  }
  if (!isDisposableValidationSession(session)) {
    scheduleMemorySynthesis(ctx, env, session.user.id, "manual_memory_deleted");
  }
  return jsonResponse({ ok: true }, 200, session);
}

async function handleMemorySourceFeedback(request: Request, env: StateApiEnv) {
  const session = await requireNativeSession(request, env);
  if (!session) return unauthorizedResponse();
  if (request.method !== "POST") return methodNotAllowed(["POST"], session);
  const freeze = writeFreezeResponse(env, "memory-feedback", session);
  if (freeze) return freeze;
  const json = await readBoundedJson(request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status, session);
  const feedback = parseMemoryFeedback(json.value);
  if (!feedback) return jsonResponse({ error: "Invalid feedback" }, 400, session);

  const [ownedRun, ownedMemory, ownedTurn, summary] = await Promise.all([
    feedback.aiRunId
      ? env.DB.prepare(
          `select a.id from ai_runs a
           inner join chats c on c.id = a.chat_id
           where a.id = ?1 and c.user_id = ?2 limit 1`,
        )
          .bind(feedback.aiRunId, session.user.id)
          .first<{ id: string }>()
      : Promise.resolve(null),
    feedback.memoryId
      ? getOwnedMemory(env, session.user.id, feedback.memoryId, false)
      : Promise.resolve(null),
    feedback.chatTurnId
      ? env.DB.prepare(
          "select id from chat_memory_turns where id = ?1 and user_id = ?2 limit 1",
        )
          .bind(feedback.chatTurnId, session.user.id)
          .first<{ id: string }>()
      : Promise.resolve(null),
    feedback.summarySectionId && feedback.action === "dont_mention"
      ? env.DB.prepare(NATIVE_BOUNDED_MEMORY_SECTIONS_SQL)
          .bind(session.user.id)
          .first<MemorySummarySectionsRow>()
      : Promise.resolve(null),
  ]);
  if (feedback.aiRunId && !ownedRun) return jsonResponse({ error: "AI run not found" }, 404, session);
  if (feedback.memoryId && !ownedMemory) return jsonResponse({ error: "Memory not found" }, 404, session);
  if (feedback.chatTurnId && !ownedTurn) return jsonResponse({ error: "Source not found" }, 404, session);

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  if (feedback.memoryId && (feedback.action === "dont_mention" || feedback.action === "not_relevant")) {
    statements.push(
      env.DB.prepare(
        `update user_memories set do_not_mention = 1, updated_at = ?1
         where id = ?2 and user_id = ?3`,
      ).bind(now, feedback.memoryId, session.user.id),
    );
  }
  if (summary && feedback.summarySectionId) {
    const parsedSections = parseRewritableBoundedMemorySummarySections(summary.sections);
    if (parsedSections?.some((section) => section.id === feedback.summarySectionId)) {
      const sections = parsedSections.map((section) =>
        section.id === feedback.summarySectionId ? { ...section, doNotMention: true } : section,
      );
      statements.push(
        env.DB.prepare(
          `update user_memory_summaries
           set sections = ?1, updated_at = ?2
           where user_id = ?3`,
        ).bind(JSON.stringify(sections), now, session.user.id),
      );
    }
  }
  const feedbackId = crypto.randomUUID();
  statements.push(
    env.DB.prepare(
      `insert into memory_source_feedback (
         id, user_id, ai_run_id, memory_id, chat_turn_id,
         summary_section_id, action, note, created_at
       ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      feedbackId,
      session.user.id,
      feedback.aiRunId,
      feedback.memoryId,
      feedback.chatTurnId,
      feedback.summarySectionId,
      feedback.action,
      feedback.note,
      now,
    ),
    memoryEventStatement(env, {
      userId: session.user.id,
      memoryId: feedback.memoryId,
      eventType: "feedback",
      metadata: {
        aiRunId: feedback.aiRunId,
        chatTurnId: feedback.chatTurnId,
        summarySectionId: feedback.summarySectionId,
        action: feedback.action,
      },
      now,
    }),
  );
  await env.DB.batch(statements);
  return jsonResponse({ ok: true }, 200, session);
}

async function handleAnalyticsEvent(
  request: Request,
  env: StateApiEnv,
  ctx: StateApiExecutionContext,
) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const freeze = writeFreezeResponse(env, "analytics");
  if (freeze) return freeze;
  const json = await readBoundedJson(request);
  if (!json.ok) return jsonResponse({ ok: false }, 400);
  const event = parseProductEvent(json.value);
  if (!event || !allowedProductEvents.has(event.name)) return jsonResponse({ ok: false }, 400);

  const session = await requireNativeSession(request, env, { refresh: false });
  const admitted = session
    ? await admitSignedInAnalytics(env, session.user.id)
    : await admitAnonymousAnalytics(request, env);
  if (!admitted) {
    return jsonResponse({ ok: true, recorded: false }, 200, session ?? undefined);
  }
  const userAgentHash = await hashUserAgent(request.headers.get("user-agent"));
  const statement = env.DB.prepare(
    `insert into product_events (
       id, name, user_id, user_email_snapshot, route,
       session_id, user_agent_hash, properties, created_at
     ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(
    crypto.randomUUID(),
    event.name,
    session?.user.id ?? null,
    session?.user.email ?? null,
    sanitizeRoute(event.route),
    event.sessionId,
    userAgentHash,
    JSON.stringify(sanitizeProperties(event.properties)),
    Date.now(),
  );
  ctx.waitUntil(
    statement.run().catch((error) => {
      console.warn(
        JSON.stringify({
          event: "native_product_event_record_failed",
          name: event.name,
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }),
  );
  return jsonResponse({ ok: true, recorded: true }, 200, session ?? undefined);
}

async function loadMemoryDashboard(
  env: StateApiEnv,
  userId: string,
  cursor: MemoryPageCursor | null = null,
) {
  const memoryBindings: Array<string | number> = [userId];
  let memoryCursorFilter = "";
  if (cursor) {
    memoryBindings.push(cursor.salience, cursor.updatedAt, cursor.id);
    memoryCursorFilter = `
       and (
         salience < ?2
         or (salience = ?2 and updated_at < ?3)
         or (salience = ?2 and updated_at = ?3 and id < ?4)
       )`;
  }
  const [settings, memories, profiles, summary] = await Promise.all([
    loadMemorySettings(env, userId),
    env.DB.prepare(
      `${memorySelectSql({ boundedContent: true })}
       where user_id = ?1 and status = 'active'
         and not (do_not_mention = 1 and source_type = 'prior_chat')${memoryCursorFilter}
       order by salience desc, updated_at desc, id desc
       limit ${maxMemoryDashboardItems + 1}`,
    )
      .bind(...memoryBindings)
      .all<MemoryRow>(),
    env.DB.prepare(NATIVE_BOUNDED_MEMORY_PROFILES_SQL)
      .bind(userId)
      .all<MemoryProfileRow>(),
    env.DB.prepare(NATIVE_BOUNDED_MEMORY_DASHBOARD_SUMMARY_SQL)
      .bind(userId)
      .first<MemorySummaryRow>(),
  ]);
  const memoryRows = memories.results.slice(0, maxMemoryDashboardItems);
  const hasMoreMemories = memories.results.length > maxMemoryDashboardItems;
  const lastMemory = hasMoreMemories ? memoryRows.at(-1) : undefined;

  return {
    settings: serializeMemorySettings(settings),
    summary: summary
      ? {
          summary: boundedMemorySummaryText(summary.summary),
          sections: parseBoundedMemorySummarySections(summary.sections) ?? [],
          lastSynthesizedAt: isoTimestamp(summary.lastSynthesizedAt),
          updatedAt: isoTimestamp(summary.updatedAt),
        }
      : null,
    profiles: profiles.results
      .slice(0, MAX_MEMORY_PROFILE_ROWS)
      .flatMap((profile) => {
        const category = boundedMemoryProfileCategory(profile.category);
        const profileSummary = boundedMemoryProfileSummary(profile.summary);
        return category && profileSummary
          ? [{ category, summary: profileSummary, updatedAt: isoTimestamp(profile.updatedAt) }]
          : [];
      }),
    memories: memoryRows
      .filter((memory) => isUsefulMemoryContent(memory.content))
      .map(serializeMemory),
    memoryPage: {
      hasMore: hasMoreMemories,
      nextCursor: lastMemory ? serializeMemoryPageCursor(lastMemory) : null,
      limit: maxMemoryDashboardItems,
    },
  };
}

async function loadMemorySettings(env: StateApiEnv, userId: string): Promise<MemorySettingsRow> {
  const row = await env.DB.prepare(
    `select
       user_id as userId, enabled,
       saved_memory_enabled as savedMemoryEnabled,
       chat_history_enabled as chatHistoryEnabled,
       dreaming_enabled as dreamingEnabled,
       capture_scope as captureScope,
       retrieval_mode as retrievalMode,
       notice_seen_at as noticeSeenAt,
       created_at as createdAt, updated_at as updatedAt
     from user_memory_settings where user_id = ?1 limit 1`,
  )
    .bind(userId)
    .first<MemorySettingsRow>();
  if (row) return row;
  const now = Date.now();
  return {
    userId,
    enabled: 1,
    savedMemoryEnabled: 1,
    chatHistoryEnabled: 1,
    dreamingEnabled: 1,
    captureScope: "broad",
    retrievalMode: "need_based",
    noticeSeenAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function getOwnedMemory(
  env: StateApiEnv,
  userId: string,
  memoryId: string,
  activeOnly: boolean,
) {
  return env.DB.prepare(
    `${memorySelectSql()}
     where id = ?1 and user_id = ?2${activeOnly ? " and status = 'active'" : ""}
     limit 1`,
  )
    .bind(memoryId, userId)
    .first<MemoryRow>();
}

function memorySelectSql(options: { boundedContent?: boolean } = {}) {
  const contentSelection = options.boundedContent
    ? `substr(content, 1, ${maxMemoryDisplayChars}) as content`
    : "content";
  return `select
    id, user_id as userId, kind, category, ${contentSelection}, tags,
    confidence, salience, status, source_type as sourceType,
    source_turn_ids as sourceTurnIds,
    source_memory_ids as sourceMemoryIds,
    source_chat_id as sourceChatId,
    source_message_id as sourceMessageId,
    embedding, valid_from as validFrom, valid_until as validUntil,
    freshness_status as freshnessStatus, pinned,
    do_not_mention as doNotMention,
    created_at as createdAt, updated_at as updatedAt,
    last_used_at as lastUsedAt, deleted_at as deletedAt
  from user_memories`;
}

async function loadMemoryVectorIds(
  env: StateApiEnv,
  userId: string,
  options: { priorChatOnly?: boolean } = {},
): Promise<MemoryVectorIds> {
  const memoryFilter = options.priorChatOnly
    ? "and status = 'active' and source_type in ('prior_chat', 'synthesized')"
    : "";
  const [memories, summaries, turns] = await Promise.all([
    env.DB.prepare(
      `select id from user_memories where user_id = ?1 ${memoryFilter} limit ${maxVectorCleanupRows}`,
    )
      .bind(userId)
      .all<VectorIdRow>(),
    env.DB.prepare(
      `select chat_id as id from chat_memory_summaries
       where user_id = ?1 limit ${maxVectorCleanupRows}`,
    )
      .bind(userId)
      .all<VectorIdRow>(),
    env.DB.prepare(
      `select id from chat_memory_turns where user_id = ?1 limit ${maxVectorCleanupRows}`,
    )
      .bind(userId)
      .all<VectorIdRow>(),
  ]);
  return {
    memories: memories.results.map((row) => row.id),
    summaries: summaries.results.map((row) => row.id),
    turns: turns.results.map((row) => row.id),
  };
}

function scheduleVectorCleanup(
  ctx: StateApiExecutionContext,
  env: StateApiEnv,
  ids: MemoryVectorIds,
) {
  if (!env.MEMORY_VECTORIZE) return;
  const vectorIds = [
    ...ids.memories.map((id) => `user_memories:${id}`),
    ...ids.summaries.map((id) => `chat_memory_summaries:${id}`),
    ...ids.turns.map((id) => `chat_memory_turns:${id}`),
  ];
  if (!vectorIds.length) return;
  ctx.waitUntil(
    deleteVectorChunks(env.MEMORY_VECTORIZE, vectorIds).catch((error) => {
      console.warn(
        JSON.stringify({
          event: "native_memory_vector_cleanup_failed",
          count: vectorIds.length,
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }),
  );
}

async function deleteVectorChunks(index: VectorizeIndex, ids: string[]) {
  for (let offset = 0; offset < ids.length; offset += 1_000) {
    await index.deleteByIds(ids.slice(offset, offset + 1_000));
  }
}

function scheduleMemorySynthesis(
  ctx: StateApiExecutionContext,
  env: StateApiEnv,
  userId: string,
  reason: string,
) {
  if (!env.MEMORY_POST_TURN_QUEUE) {
    console.warn(JSON.stringify({ event: "native_memory_synthesis_not_queued", reason: "missing_binding" }));
    return;
  }
  const message = {
    type: "memory.daily_synthesis.v1" as const,
    enqueuedAt: new Date().toISOString(),
    userId,
    reason: reason.slice(0, 80),
  };
  ctx.waitUntil(
    env.MEMORY_POST_TURN_QUEUE.send(message, { contentType: "json" }).catch((error) => {
      console.warn(
        JSON.stringify({
          event: "native_memory_synthesis_queue_failed",
          reason,
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }),
  );
}

async function consumeMemoryQuota(env: StateApiEnv, key: string): Promise<QuotaDecision> {
  const limit = nonNegativeInteger(env.RATE_LIMIT_MEMORY_DAILY, 60);
  const now = Date.now();
  const resetAt = now + oneDayMs;
  if (limit <= 0) return { ok: false, retryAfterSeconds: 1 };
  try {
    const result = await env.DB.prepare(
      `insert into rate_limit_windows ("key", count, reset_at, created_at, updated_at)
       values (?1, 1, ?2, ?3, ?3)
       on conflict ("key") do update set
         count = case when rate_limit_windows.reset_at <= ?3 then 1 else rate_limit_windows.count + 1 end,
         reset_at = case when rate_limit_windows.reset_at <= ?3 then excluded.reset_at else rate_limit_windows.reset_at end,
         updated_at = excluded.updated_at
       where rate_limit_windows.reset_at <= ?3 or rate_limit_windows.count < ?4
       returning count, reset_at as resetAt`,
    )
      .bind(key, resetAt, now, limit)
      .all<{ count: number; resetAt: number }>();
    const row = result.results[0];
    if (row) return { ok: true };
    const existing = await env.DB.prepare(
      `select reset_at as resetAt from rate_limit_windows where "key" = ?1 limit 1`,
    )
      .bind(key)
      .first<{ resetAt: number }>();
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil(((existing?.resetAt ?? resetAt) - now) / 1_000)),
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "native_memory_quota_check_failed",
        posture: "fail_open",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return { ok: true };
  }
}

function memoryEventStatement(
  env: StateApiEnv,
  input: {
    userId: string;
    memoryId?: string | null;
    chatId?: string | null;
    messageId?: string | null;
    eventType: string;
    reason?: string | null;
    metadata?: JsonObject;
    now: number;
  },
) {
  return env.DB.prepare(
    `insert into memory_events (
       id, user_id, memory_id, chat_id, message_id,
       event_type, reason, metadata, created_at
     ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(
    crypto.randomUUID(),
    input.userId,
    input.memoryId ?? null,
    input.chatId ?? null,
    input.messageId ?? null,
    input.eventType,
    input.reason ?? null,
    JSON.stringify(input.metadata ?? {}),
    input.now,
  );
}

function serializeChat(row: ChatRow) {
  return {
    id: row.id,
    userId: row.userId,
    userEmailSnapshot: row.userEmailSnapshot,
    topicId: row.topicId,
    topicNameSnapshot: row.topicNameSnapshot,
    title: row.title,
    isArchived: toBoolean(row.isArchived),
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
  };
}

function serializeOwnedTopic(row: OwnedChatRow) {
  if (!row.topicDbId || !row.topicSlug || !row.topicName) return null;
  const metadata = parseJsonObject(row.topicMetadata);
  const safeMetadata: JsonObject = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (publicTopicMetadataKeys.has(key)) safeMetadata[key] = value;
  }
  return {
    id: row.topicDbId,
    slug: row.topicSlug,
    name: row.topicName,
    subText: row.topicSubText ?? "",
    description: row.topicDescription ?? "",
    inputboxText: row.topicInputboxText ?? "",
    iconUrl: row.topicIconUrl,
    sortOrder: row.topicSortOrder ?? 0,
    metadata: safeMetadata,
  };
}

function serializeBoundedMessages(rows: MessageRow[]) {
  const recent: Array<{ row: MessageRow; content: string; nextOffset: number | null }> = [];
  let remainingChars = maxSavedChatResponseChars;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;
    if (!row.content) {
      recent.push({ row, content: "", nextOffset: null });
      continue;
    }
    if (remainingChars <= 0) break;
    const allowedChars = Math.min(maxSavedMessageChars, remainingChars);
    const chunk = takeUnicodePrefix(row.content, allowedChars);
    remainingChars -= chunk.characters;
    recent.push({
      row,
      content: chunk.content,
      nextOffset: chunk.hasMore ? chunk.characters : null,
    });
  }
  return recent
    .reverse()
    .map(({ row, content, nextOffset }) => serializeMessage(row, content, nextOffset));
}

function serializeMessage(
  row: MessageRow,
  content: string,
  contentNextOffset: number | null,
) {
  const metadata = parseJsonObject(row.metadata);
  const memoryContext = parseJsonObject(row.memoryContext);
  const sources = Array.isArray(memoryContext.sources) ? memoryContext.sources.slice(0, 100) : [];
  const memoryMetadata: JsonObject = { ...metadata };
  if (row.role === "assistant" && row.aiRunId && sources.length) {
    memoryMetadata.aiRunId = row.aiRunId;
    memoryMetadata.memorySources = sources;
  }
  delete memoryMetadata.contentTruncated;
  delete memoryMetadata.contentNextOffset;
  if (contentNextOffset !== null) {
    memoryMetadata.contentTruncated = true;
    memoryMetadata.contentNextOffset = contentNextOffset;
  }
  return {
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    content,
    metadata: memoryMetadata,
    createdAt: isoTimestamp(row.createdAt),
  };
}

function serializeActivityRun(row: ActivityRunRow) {
  const state = sanitizeActivityState(row.type, parseJsonObject(row.state));
  return {
    id: row.id,
    chatId: row.chatId,
    type: row.type,
    status: row.status,
    state,
    score: row.score,
    maxScore: row.maxScore,
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
    completedAt: row.completedAt === null ? null : isoTimestamp(row.completedAt),
  };
}

function sanitizeActivityState(type: string, state: JsonObject) {
  if (type === "quiz" && Array.isArray(state.questions)) {
    return {
      ...state,
      questions: state.questions.slice(0, 10).map((value) => {
        const question = parseJsonObject(value);
        const answered = typeof question.userAnswerIndex === "number";
        const sanitized = { ...question };
        if (!answered) {
          delete sanitized.correctIndex;
          delete sanitized.explanation;
          delete sanitized.isCorrect;
        } else if (typeof question.correctIndex === "number") {
          sanitized.isCorrect = question.userAnswerIndex === question.correctIndex;
        }
        return sanitized;
      }),
    };
  }
  if (type === "flashcards" && Array.isArray(state.cards)) {
    const completed = state.completed === true;
    return {
      ...state,
      cards: state.cards.slice(0, 12).map((value) => {
        const card = parseJsonObject(value);
        const visible = completed || card.isRevealed === true || typeof card.rating === "string";
        if (visible) return card;
        const sanitized = { ...card };
        delete sanitized.back;
        delete sanitized.example;
        delete sanitized.trap;
        return sanitized;
      }),
    };
  }
  return state;
}

function serializeMemorySettings(settings: MemorySettingsRow) {
  return {
    enabled: toBoolean(settings.enabled),
    savedMemoryEnabled: toBoolean(settings.savedMemoryEnabled),
    chatHistoryEnabled: toBoolean(settings.chatHistoryEnabled),
    dreamingEnabled: toBoolean(settings.dreamingEnabled),
    captureScope: settings.captureScope,
    retrievalMode: settings.retrievalMode,
    noticeSeenAt: settings.noticeSeenAt === null ? null : isoTimestamp(settings.noticeSeenAt),
  };
}

function serializeMemory(memory: MemoryRow) {
  const tags = stringArray(memory.tags, 8, 32);
  const content = memory.content.slice(0, maxMemoryDisplayChars);
  return {
    id: memory.id,
    kind: memory.kind,
    category: memory.category,
    content,
    displayContent: displayMemoryContent(content),
    sourceLabel: memorySourceLabel(memory.kind, tags, memory.sourceType),
    tags,
    confidence: memory.confidence,
    salience: memory.salience,
    sourceType: memory.sourceType,
    freshnessStatus: memory.freshnessStatus,
    pinned: toBoolean(memory.pinned),
    doNotMention: toBoolean(memory.doNotMention),
    createdAt: isoTimestamp(memory.createdAt),
    updatedAt: isoTimestamp(memory.updatedAt),
  };
}

function memorySourceLabel(kind: string, tags: string[], sourceType: string) {
  if (sourceType === "manual" || tags.includes("manual")) return "Added manually";
  if (sourceType === "prior_chat" || tags.includes("prior_chat")) return "From previous chat";
  if (sourceType === "synthesized") return "Synthesized from chats";
  if (kind === "explicit") return "Remembered from chat";
  return "Learned from chats";
}

function parseMemoryCreate(value: unknown) {
  if (!isRecord(value)) return null;
  const content = boundedTrimmedString(value.content, 5, 600);
  const categoryValue = value.category === undefined ? "general" : boundedTrimmedString(value.category, 1, 60);
  if (!content || !categoryValue || !memoryCategories.has(categoryValue)) return null;
  return { content, category: categoryValue };
}

function parseMemorySettingsPatch(value: unknown) {
  if (!isRecord(value)) return null;
  const booleanKeys = [
    "enabled",
    "savedMemoryEnabled",
    "chatHistoryEnabled",
    "dreamingEnabled",
    "noticeSeen",
    "refreshSummary",
  ] as const;
  for (const key of booleanKeys) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return null;
  }
  const correction = value.correction === undefined
    ? undefined
    : boundedTrimmedString(value.correction, 5, 800);
  if (value.correction !== undefined && !correction) return null;
  return {
    enabled: booleanValue(value.enabled),
    savedMemoryEnabled: booleanValue(value.savedMemoryEnabled),
    chatHistoryEnabled: booleanValue(value.chatHistoryEnabled),
    dreamingEnabled: booleanValue(value.dreamingEnabled),
    noticeSeen: booleanValue(value.noticeSeen),
    refreshSummary: booleanValue(value.refreshSummary),
    correction,
  };
}

function parseMemoryItemPatch(value: unknown) {
  if (!isRecord(value)) return null;
  const content = value.content === undefined ? undefined : boundedTrimmedString(value.content, 1, 600);
  const category = value.category === undefined ? undefined : boundedTrimmedString(value.category, 1, 60);
  if (value.content !== undefined && !content) return null;
  if (value.category !== undefined && !category) return null;
  let tags: string[] | undefined;
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > 8) return null;
    tags = [];
    for (const tag of value.tags) {
      const parsed = boundedTrimmedString(tag, 1, 32);
      if (!parsed) return null;
      tags.push(parsed);
    }
  }
  if (value.pinned !== undefined && typeof value.pinned !== "boolean") return null;
  if (value.doNotMention !== undefined && typeof value.doNotMention !== "boolean") return null;
  return {
    content,
    category,
    tags,
    pinned: booleanValue(value.pinned),
    doNotMention: booleanValue(value.doNotMention),
  };
}

function parseMemoryFeedback(value: unknown) {
  if (!isRecord(value)) return null;
  const aiRunId = optionalUuid(value.aiRunId);
  const memoryId = optionalUuid(value.memoryId);
  const chatTurnId = optionalUuid(value.chatTurnId);
  const summarySectionId = value.summarySectionId === undefined
    ? null
    : boundedTrimmedString(value.summarySectionId, 1, 120);
  const note = value.note === undefined ? null : boundedTrimmedString(value.note, 0, 800);
  const action = value.action;
  if (value.aiRunId !== undefined && !aiRunId) return null;
  if (value.memoryId !== undefined && !memoryId) return null;
  if (value.chatTurnId !== undefined && !chatTurnId) return null;
  if (value.summarySectionId !== undefined && !summarySectionId) return null;
  if (value.note !== undefined && note === null) return null;
  if (action !== "relevant" && action !== "not_relevant" && action !== "dont_mention" && action !== "correction") {
    return null;
  }
  return { aiRunId, memoryId, chatTurnId, summarySectionId, action, note };
}

function parseProductEvent(value: unknown) {
  if (!isRecord(value)) return null;
  const name = boundedTrimmedString(value.name, 1, 80);
  const route = value.route === undefined ? null : boundedTrimmedString(value.route, 0, 180);
  const sessionId = value.sessionId === undefined ? null : boundedTrimmedString(value.sessionId, 0, 120);
  if (!name || (value.route !== undefined && route === null) || (value.sessionId !== undefined && sessionId === null)) {
    return null;
  }
  if (value.properties !== undefined && !isRecord(value.properties)) return null;
  return { name, route, sessionId, properties: isRecord(value.properties) ? value.properties : undefined };
}

function sanitizeRoute(route: string | null) {
  if (!route) return null;
  const path = route.split(/[?#]/, 1)[0] || "/";
  return (path.startsWith("/") ? path : `/${path}`).slice(0, 180);
}

function sanitizeProperties(properties: JsonObject | undefined) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties ?? {}).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_.:-]{1,60}$/.test(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 240);
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean" || value === null) safe[key] = value;
  }
  return safe;
}

async function admitAnonymousAnalytics(request: Request, env: StateApiEnv) {
  let identity: Awaited<ReturnType<typeof deriveAnonymousAnalyticsIdentity>>;
  try {
    identity = await deriveAnonymousAnalyticsIdentity(request, env.AUTH_SECRET);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "native_anonymous_analytics_sampling_failed",
        posture: "drop_event",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return false;
  }
  if (!identity?.sampled) return false;

  return consumeAnalyticsFixedWindow(
    env,
    identity.quotaKey,
    anonymousAnalyticsHourlyLimit,
    "anonymous",
  );
}

async function admitSignedInAnalytics(env: StateApiEnv, userId: string) {
  let quotaKey: string | null;
  try {
    quotaKey = await deriveSignedInAnalyticsQuotaKey(userId, env.AUTH_SECRET);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "native_signed_analytics_identity_failed",
        posture: "drop_event",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return false;
  }
  if (!quotaKey) return false;
  return consumeAnalyticsFixedWindow(
    env,
    quotaKey,
    signedInAnalyticsHourlyLimit,
    "signed_in",
  );
}

async function consumeAnalyticsFixedWindow(
  env: StateApiEnv,
  quotaKey: string,
  limit: number,
  scope: "anonymous" | "signed_in",
) {
  const now = Date.now();
  const resetAt = Math.floor(now / oneHourMs) * oneHourMs + oneHourMs;
  try {
    const admitted = await env.DB.prepare(
      `insert into rate_limit_windows ("key", count, reset_at, created_at, updated_at)
       values (?1, 1, ?2, ?3, ?3)
       on conflict ("key") do update set
         count = case when rate_limit_windows.reset_at <= ?3 then 1 else rate_limit_windows.count + 1 end,
         reset_at = case when rate_limit_windows.reset_at <= ?3 then excluded.reset_at else rate_limit_windows.reset_at end,
         updated_at = excluded.updated_at
       where rate_limit_windows.reset_at <= ?3 or rate_limit_windows.count < ?4
       returning count`,
    )
      .bind(quotaKey, resetAt, now, limit)
      .first<{ count: number }>();
    return Boolean(admitted);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "native_analytics_admission_failed",
        scope,
        posture: "drop_event",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return false;
  }
}

export async function deriveAnonymousAnalyticsIdentity(
  request: Request,
  secret: string,
  nowMs = Date.now(),
) {
  const ip = trustedCloudflareIp(request.headers.get("cf-connecting-ip"));
  if (!ip || !secret || secret.length > 4_096) return null;
  const day = Math.floor(nowMs / oneDayMs);
  const digest = await hmacSha256(secret, `${day}\u0000${ip}`);
  const quotaHash = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    sampled: (digest[0] ?? 255) < 256 / anonymousAnalyticsSampleDivisor,
    quotaKey: `analytics:anonymous:${day}:${quotaHash}`,
  } as const;
}

export async function deriveSignedInAnalyticsQuotaKey(
  userId: string,
  secret: string,
) {
  if (!boundedTrimmedString(userId, 1, 512) || !secret || secret.length > 4_096) {
    return null;
  }
  const digest = await hmacSha256(secret, `signed-analytics\u0000${userId}`);
  const quotaHash = Array.from(
    digest.slice(0, 16),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  // reset_at advances the fixed window in-place; rotating the key itself would
  // leave one persistent D1 row per active user per hour.
  return `analytics:signed:${quotaHash}`;
}

async function hmacSha256(secret: string, value: string) {
  return nativeAuthHmacBytes(value, secret);
}

function trustedCloudflareIp(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f:.]{3,64}$/.test(normalized) ? normalized : null;
}

async function hashUserAgent(userAgent: string | null) {
  if (!userAgent) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userAgent.slice(0, 500)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

export function parseMemoryPageCursor(value: string | null): MemoryPageCursor | null {
  if (!value || value.length > 300) return null;
  const firstSeparator = value.indexOf(":");
  const secondSeparator = value.indexOf(":", firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 1) return null;
  const salience = Number(value.slice(0, firstSeparator));
  const updatedAt = Number(value.slice(firstSeparator + 1, secondSeparator));
  let id: string;
  try {
    id = decodeURIComponent(value.slice(secondSeparator + 1));
  } catch {
    return null;
  }
  if (
    !Number.isSafeInteger(salience) ||
    salience < 0 ||
    salience > 1_000_000 ||
    !Number.isSafeInteger(updatedAt) ||
    updatedAt < 0 ||
    !boundedTrimmedString(id, 1, 120)
  ) {
    return null;
  }
  return { salience, updatedAt, id };
}

export function parseChatMessagePageCursor(
  value: string | null,
): ChatMessagePageCursor | null {
  if (!value || value.length > 260) return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  const createdAt = Number(value.slice(0, separator));
  let id: string;
  try {
    id = decodeURIComponent(value.slice(separator + 1));
  } catch {
    return null;
  }
  if (
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    !boundedTrimmedString(id, 1, 120)
  ) {
    return null;
  }
  return { createdAt, id };
}

function serializeChatMessagePageCursor(
  message: Pick<MessageRow, "id" | "createdAt">,
) {
  return `${Math.trunc(message.createdAt)}:${encodeURIComponent(message.id)}`;
}

function serializeMemoryPageCursor(memory: Pick<MemoryRow, "id" | "salience" | "updatedAt">) {
  return `${Math.trunc(memory.salience)}:${Math.trunc(memory.updatedAt)}:${encodeURIComponent(memory.id)}`;
}

async function readBoundedJson(request: Request): Promise<ReadJsonResult> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    return { ok: false, status: 415, error: "Requests must use JSON" };
  }
  const advertised = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(advertised) && advertised > maxStateRequestBytes) {
    return { ok: false, status: 413, error: "Request is too large" };
  }
  if (!request.body) return { ok: false, status: 400, error: "Invalid request" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxStateRequestBytes) {
        await reader.cancel("native_state_body_too_large").catch(() => undefined);
        return { ok: false, status: 413, error: "Request is too large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    await reader.cancel("invalid_native_state_body").catch(() => undefined);
    return { ok: false, status: 400, error: "Invalid request" };
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, error: "Invalid request" };
  }
}

function writeFreezeResponse(
  env: StateApiEnv,
  surface: string,
  session?: NativeAuthenticatedSession,
) {
  const enabled = truthyValues.has((env.APP_WRITE_FREEZE ?? env.WRITE_FREEZE ?? "").trim().toLowerCase());
  if (!enabled) return null;
  return jsonResponse(
    {
      error: "The service is temporarily read-only while a migration is in progress.",
      code: "write_freeze_active",
      surface,
    },
    503,
    session,
    {
      "retry-after": String(
        positiveInteger(env.APP_WRITE_FREEZE_RETRY_AFTER_SECONDS, defaultWriteFreezeRetrySeconds),
      ),
    },
  );
}

function unauthorizedResponse() {
  return jsonResponse({ error: "Unauthorized" }, 401);
}

function methodNotAllowed(methods: string[], session?: NativeAuthenticatedSession) {
  return jsonResponse(
    { error: "Method not allowed" },
    405,
    session,
    { allow: methods.join(", ") },
  );
}

function jsonResponse(
  body: unknown,
  status: number,
  session?: NativeAuthenticatedSession,
  extraHeaders?: HeadersInit,
) {
  const headers = privateNoStoreHeaders(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("vary", appendVary(headers.get("vary"), "Cookie"));
  headers.set("x-inspir-delivery", NATIVE_STATE_API_DELIVERY);
  if (session) appendNativeSessionRefresh(headers, session);
  return new Response(JSON.stringify(body), { status, headers });
}

function pathIdentifier(pathname: string, prefix: string) {
  if (!pathname.startsWith(prefix)) return null;
  const remainder = pathname.slice(prefix.length);
  return remainder && !remainder.includes("/") ? remainder : null;
}

function parseChatMessagePath(pathname: string) {
  const segments = pathname.split("/");
  if (
    segments.length !== 6 ||
    segments[1] !== "api" ||
    segments[2] !== "chats" ||
    !segments[3] ||
    segments[4] !== "messages" ||
    !segments[5]
  ) {
    return null;
  }
  return { rawChatId: segments[3], rawMessageId: segments[5] };
}

function parseMessageContentOffset(value: string | null) {
  if (!value || !/^(?:0|[1-9]\d{0,8})$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= maxSavedMessageOffset
    ? offset
    : null;
}

export function buildBoundedMessageContentChunk(value: string, offset: number) {
  const chunk = takeUnicodePrefix(value, maxSavedMessageChars);
  return {
    content: chunk.content,
    hasMore: chunk.hasMore,
    nextOffset: chunk.hasMore ? offset + chunk.characters : null,
  };
}

function takeUnicodePrefix(value: string, limit: number) {
  let characters = 0;
  let codeUnits = 0;
  for (const character of value) {
    if (characters >= limit) break;
    characters += 1;
    codeUnits += character.length;
  }
  return {
    content: value.slice(0, codeUnits),
    characters,
    hasMore: codeUnits < value.length,
  };
}

function decodedUuid(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return uuidPattern.test(decoded) ? decoded.toLowerCase() : null;
  } catch {
    return null;
  }
}

function optionalUuid(value: unknown) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && uuidPattern.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function parseJsonObject(value: unknown): JsonObject {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || value.length > maxJsonColumnChars) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function boundedMemorySummaryText(value: unknown) {
  return boundedTextPrefix(value, MAX_MEMORY_SUMMARY_CHARS) ?? "";
}

export function boundedMemoryProfileCategory(value: unknown) {
  return boundedTrimmedString(value, 1, MAX_MEMORY_PROFILE_CATEGORY_CHARS);
}

export function boundedMemoryProfileSummary(value: unknown) {
  return boundedTrimmedPrefix(value, MAX_MEMORY_PROFILE_SUMMARY_CHARS);
}

export function parseBoundedMemorySummarySections(value: unknown): NativeSummarySection[] | null {
  return parseBoundedMemorySummarySectionsResult(value)?.sections ?? null;
}

export function parseRewritableBoundedMemorySummarySections(
  value: unknown,
): NativeSummarySection[] | null {
  const result = parseBoundedMemorySummarySectionsResult(value);
  return result?.rewriteSafe ? result.sections : null;
}

function parseBoundedMemorySummarySectionsResult(value: unknown): {
  sections: NativeSummarySection[];
  rewriteSafe: boolean;
} | null {
  if (
    typeof value !== "string" ||
    value.length > MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const sections: NativeSummarySection[] = [];
  const seenIds = new Set<string>();
  let rewriteSafe = parsed.length <= MAX_MEMORY_SUMMARY_SECTIONS;
  for (const candidate of parsed.slice(0, MAX_MEMORY_SUMMARY_SECTIONS)) {
    if (!isRecord(candidate)) {
      rewriteSafe = false;
      continue;
    }
    if (
      Object.keys(candidate).some(
        (key) =>
          key !== "id" &&
          key !== "title" &&
          key !== "category" &&
          key !== "summary" &&
          key !== "sourceMemoryIds" &&
          key !== "sourceTurnIds" &&
          key !== "doNotMention",
      )
    ) {
      rewriteSafe = false;
    }
    const id = boundedTrimmedString(candidate.id, 1, MAX_MEMORY_SUMMARY_SECTION_ID_CHARS);
    const title = boundedTrimmedPrefix(candidate.title, MAX_MEMORY_SUMMARY_SECTION_TITLE_CHARS);
    const category = boundedTrimmedString(candidate.category, 1, MAX_MEMORY_PROFILE_CATEGORY_CHARS);
    const summary = boundedTrimmedPrefix(
      candidate.summary,
      MAX_MEMORY_SUMMARY_SECTION_SUMMARY_CHARS,
    );
    if (!id || !title || !category || !summary || seenIds.has(id)) {
      rewriteSafe = false;
      continue;
    }
    if (
      !isTrimmedStringWithin(candidate.title, MAX_MEMORY_SUMMARY_SECTION_TITLE_CHARS) ||
      !isTrimmedStringWithin(candidate.summary, MAX_MEMORY_SUMMARY_SECTION_SUMMARY_CHARS)
    ) {
      rewriteSafe = false;
    }
    seenIds.add(id);

    const sourceMemoryIds = boundedMemorySummarySourceIds(candidate.sourceMemoryIds);
    const sourceTurnIds = boundedMemorySummarySourceIds(candidate.sourceTurnIds);
    if (
      !sourceMemoryIds.rewriteSafe ||
      !sourceTurnIds.rewriteSafe ||
      (candidate.doNotMention !== undefined && typeof candidate.doNotMention !== "boolean")
    ) {
      rewriteSafe = false;
    }
    sections.push({
      id,
      title,
      category,
      summary,
      ...(sourceMemoryIds.ids.length ? { sourceMemoryIds: sourceMemoryIds.ids } : {}),
      ...(sourceTurnIds.ids.length ? { sourceTurnIds: sourceTurnIds.ids } : {}),
      ...(candidate.doNotMention === true ? { doNotMention: true } : {}),
    });
  }
  return { sections, rewriteSafe };
}

function boundedMemorySummarySourceIds(value: unknown) {
  if (value === undefined) return { ids: [], rewriteSafe: true };
  if (!Array.isArray(value)) return { ids: [], rewriteSafe: false };
  const ids: string[] = [];
  let rewriteSafe = value.length <= MAX_MEMORY_SUMMARY_SECTION_SOURCE_IDS;
  for (const candidate of value.slice(0, MAX_MEMORY_SUMMARY_SECTION_SOURCE_IDS)) {
    const id = boundedTrimmedString(
      candidate,
      1,
      MAX_MEMORY_SUMMARY_SECTION_SOURCE_ID_CHARS,
    );
    if (id) {
      ids.push(id);
    } else {
      rewriteSafe = false;
    }
  }
  return { ids, rewriteSafe };
}

function boundedTextPrefix(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  if (value.length <= maxLength) return value;
  const prefix = value.slice(0, maxLength);
  return /[\uD800-\uDBFF]$/.test(prefix) ? prefix.slice(0, -1) : prefix;
}

function boundedTrimmedPrefix(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return boundedTextPrefix(normalized, maxLength);
}

function isTrimmedStringWithin(value: unknown, maxLength: number) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= maxLength;
}

function stringArray(value: unknown, limit: number, maxLength: number) {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed)) return [];
  const values: string[] = [];
  for (const entry of parsed.slice(0, limit)) {
    const normalized = boundedTrimmedString(entry, 1, maxLength);
    if (normalized) values.push(normalized);
  }
  return values;
}

function parseJson(value: string): unknown {
  if (value.length > maxJsonColumnChars) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function serializeJsonColumn(value: unknown) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedTrimmedString(value: unknown, minLength: number, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= minLength && normalized.length <= maxLength ? normalized : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function uniqueStrings(values: string[], limit: number) {
  return [...new Set(values)].slice(0, limit);
}

function toBoolean(value: unknown) {
  return value === true || value === 1;
}

function finiteInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function positiveInteger(value: string | undefined, fallback: number) {
  return Math.max(1, nonNegativeInteger(value, fallback));
}

function isoTimestamp(value: number) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function containsLikePattern(value: string) {
  let escaped = "";
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of value.trim()) {
    const next = /[\\%_]/.test(character) ? `\\${character}` : character;
    const nextBytes = encoder.encode(next).byteLength;
    if (bytes + nextBytes > 48) break;
    escaped += next;
    bytes += nextBytes;
  }
  return escaped ? `%${escaped}%` : null;
}

function visibleMessageContent(content: string) {
  if (content.startsWith("[Socratic session start]")) {
    const target = content.match(/^Target input:\s*(.+)$/im)?.[1]?.trim();
    return target ? `Socratic target: ${target}` : "Socratic session";
  }
  if (content.startsWith("[Coach control]")) return "Coach control";
  if (!content.startsWith("[Mini app instruction]")) return content;
  return (
    content
      .split("\n")
      .find((line) => line.trimStart().startsWith("Visible:"))
      ?.slice("Visible:".length)
      .trim() ?? ""
  );
}

function displayMemoryContent(content: string) {
  return content
    .replace(/\bthe learner's\b/gi, "your")
    .replace(/\blearner's\b/gi, "your")
    .replace(/\bthe learner\b/gi, "you")
    .replace(/\blearner\b/gi, "you")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulMemoryContent(value: string) {
  const text = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (text.length < 5) return false;
  if (/^(that|this|it|its|it's|about me|remember me)$/.test(text)) return false;
  const words = text.split(" ").filter(Boolean);
  return !(
    words.length <= 2 &&
    words.every((word) => /^(about|me|my|mine|that|this|it|remember|know)$/.test(word))
  );
}

function isDisposableValidationSession(session: NativeAuthenticatedSession) {
  return session.user.email?.endsWith("@inspirlearning.invalid") === true;
}

function appendVary(current: string | null, value: string) {
  if (!current) return value;
  const values = current.split(",").map((entry) => entry.trim().toLowerCase());
  return values.includes(value.toLowerCase()) ? current : `${current}, ${value}`;
}

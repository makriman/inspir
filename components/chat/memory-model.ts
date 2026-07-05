import type { UiTranslator } from "@/components/chat/chat-ui-types";

export type MemorySettings = {
  enabled: boolean;
  savedMemoryEnabled: boolean;
  chatHistoryEnabled: boolean;
  dreamingEnabled: boolean;
  captureScope: string;
  retrievalMode: string;
  noticeSeenAt: string | Date | null;
};

export type MemoryItem = {
  id: string;
  kind: string;
  category: string;
  content: string;
  displayContent?: string;
  sourceLabel?: string;
  tags: string[];
  confidence: number;
  salience: number;
  sourceType?: string;
  freshnessStatus?: string;
  pinned?: boolean;
  doNotMention?: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type MemorySummarySection = {
  id: string;
  title: string;
  category: string;
  summary: string;
  sourceMemoryIds?: string[];
  sourceTurnIds?: string[];
  doNotMention?: boolean;
};

export type MemorySummary = {
  summary: string;
  sections: MemorySummarySection[];
  lastSynthesizedAt: string | Date;
  updatedAt: string | Date;
};

export type MemoryProfile = {
  category: string;
  summary: string;
  updatedAt: string | Date;
};

export type MemoryDashboard = {
  settings: MemorySettings;
  summary: MemorySummary | null;
  memories: MemoryItem[];
  profiles: MemoryProfile[];
};

export type MemorySettingsPatch = {
  enabled?: boolean;
  savedMemoryEnabled?: boolean;
  chatHistoryEnabled?: boolean;
  dreamingEnabled?: boolean;
  noticeSeen?: boolean;
  refreshSummary?: boolean;
  correction?: string;
};

export type MemoryCreateInput = {
  content: string;
  category?: string;
};

export type MemoryUpdateInput = {
  content?: string;
  category?: string;
  tags?: string[];
  pinned?: boolean;
  doNotMention?: boolean;
};

export const memoryCategoryOptions = [
  { value: "preferences", label: "Preferences" },
  { value: "learning_style", label: "Learning style" },
  { value: "projects", label: "Projects" },
  { value: "goals", label: "Goals" },
  { value: "knowledge", label: "Knowledge" },
  { value: "constraints", label: "Constraints" },
  { value: "interaction", label: "Interaction" },
  { value: "identity", label: "Identity" },
  { value: "general", label: "General" },
];

export function editableMemoryText(memory: MemoryItem) {
  return memory.displayContent ?? memory.content;
}

export function groupMemoriesByCategory(memories: MemoryItem[]) {
  const map = new Map<string, MemoryItem[]>();
  for (const memory of memories) {
    const key = memory.category || "general";
    map.set(key, [...(map.get(key) ?? []), memory]);
  }
  return Array.from(map.entries())
    .toSorted(([a], [b]) => memoryCategoryLabel(a).localeCompare(memoryCategoryLabel(b)))
    .map(([category, items]) => ({ category, memories: items }));
}

function memoryCategoryLabel(category: string) {
  return category
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function translatedMemoryCategoryLabel(category: string, t: UiTranslator) {
  return t(memoryCategoryLabel(category));
}

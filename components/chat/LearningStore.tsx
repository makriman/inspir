"use client";

import { useState } from "react";
import { Check, Minus, Plus, Search, Sparkles } from "lucide-react";

type StoreTopicMetadata = {
  category?: string;
  starters?: string[];
  keywords?: string[];
  source?: string;
  uiMode?: string;
};

export type LearningStoreTopic = {
  id: string;
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
  metadata?: StoreTopicMetadata | Record<string, unknown> | null;
};

function storeTopicMetadata(topic: LearningStoreTopic): StoreTopicMetadata {
  const metadata = topic.metadata;
  if (!metadata || typeof metadata !== "object") return {};
  return metadata as StoreTopicMetadata;
}

export function learningFeatureCategory(topic: LearningStoreTopic) {
  return storeTopicMetadata(topic).category ?? "Learning";
}

export function getDefaultSidebarTopicIds(topics: LearningStoreTopic[]) {
  const ids: string[] = [];
  const seenCategories = new Set<string>();
  for (const topic of topics) {
    const category = learningFeatureCategory(topic);
    if (seenCategories.has(category)) continue;
    seenCategories.add(category);
    ids.push(topic.id);
  }
  return ids;
}

function topicSearchText(topic: LearningStoreTopic) {
  const metadata = storeTopicMetadata(topic);
  return [
    topic.name,
    topic.subText,
    topic.description,
    topic.inputboxText,
    metadata.category,
    metadata.uiMode,
    metadata.source,
    ...(metadata.starters ?? []),
    ...(metadata.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function searchTopics(topics: LearningStoreTopic[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return topics;
  return topics
    .filter((topic) => topicSearchText(topic).includes(q))
    .sort((a, b) => {
      const aName = a.name.toLowerCase().includes(q);
      const bName = b.name.toLowerCase().includes(q);
      if (aName && !bName) return -1;
      if (!aName && bName) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function LearningStore({
  topics,
  addedTopicIds,
  activeTopicId,
  onAdd,
  onRemove,
  onSelect,
}: {
  topics: LearningStoreTopic[];
  addedTopicIds: string[];
  activeTopicId: string;
  onAdd: (topicId: string) => void;
  onRemove: (topicId: string) => void;
  onSelect: (topicId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [expandedTopicId, setExpandedTopicId] = useState(activeTopicId);
  const categories = ["All", ...Array.from(new Set(topics.map(learningFeatureCategory)))];
  const filtered = searchTopics(
    category === "All" ? topics : topics.filter((topic) => learningFeatureCategory(topic) === category),
    query,
  );
  const groups = filtered.reduce<Array<{ category: string; topics: LearningStoreTopic[] }>>((acc, topic) => {
    const topicCategory = learningFeatureCategory(topic);
    const existing = acc.find((group) => group.category === topicCategory);
    if (existing) existing.topics.push(topic);
    else acc.push({ category: topicCategory, topics: [topic] });
    return acc;
  }, []);

  return (
    <main className="bubble-learning-store app-scrollbar">
      <section className="bubble-store-head">
        <div>
          <span>Learning Store</span>
          <h2>Choose what lives in your sidebar.</h2>
          <p>Search every chat mode and mini app, open details, and keep your daily tools one click away.</p>
        </div>
        <div className="bubble-store-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search features, tools, subjects, workflows..."
            aria-label="Search learning store"
          />
        </div>
      </section>

      <div className="bubble-store-categories" role="tablist" aria-label="Learning store categories">
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className={item === category ? "is-active" : ""}
          >
            {item}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="bubble-store-empty">
          <Search size={28} />
          <strong>No matching features</strong>
          <span>Try a broader search like quiz, timer, notes, focus, writing, or science.</span>
        </div>
      ) : null}

      <div className="bubble-store-groups">
        {groups.map((group) => (
          <section key={group.category} className="bubble-store-group">
            <h3>{group.category}</h3>
            <div className="bubble-store-grid">
              {group.topics.map((topic) => {
                const metadata = storeTopicMetadata(topic);
                const isAdded = addedTopicIds.includes(topic.id);
                const isExpanded = expandedTopicId === topic.id;
                const isActive = activeTopicId === topic.id;
                return (
                  <article
                    key={topic.id}
                    className={`bubble-store-tile ${isAdded ? "is-added" : ""} ${isActive ? "is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="bubble-store-tile-main"
                      onClick={() => setExpandedTopicId(isExpanded ? "" : topic.id)}
                      aria-expanded={isExpanded}
                    >
                      <div className="bubble-store-tile-top">
                        <span>{metadata.uiMode === "chat" || !metadata.uiMode ? "Chat" : "Mini app"}</span>
                        {isAdded ? (
                          <small>
                            <Check size={13} />
                            Added
                          </small>
                        ) : null}
                      </div>
                      <strong>{topic.name}</strong>
                      <p>{topic.subText}</p>
                    </button>
                    <div className="bubble-store-tile-actions">
                      <button
                        type="button"
                        className="bubble-store-open-button"
                        onClick={() => onSelect(topic.id)}
                      >
                        Open
                      </button>
                      {isAdded ? (
                        <button
                          type="button"
                          className="bubble-store-remove-button"
                          onClick={() => onRemove(topic.id)}
                          aria-label={`Remove ${topic.name} from sidebar`}
                          title={`Remove ${topic.name} from sidebar`}
                        >
                          <Minus size={18} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="bubble-store-add-button"
                          onClick={() => onAdd(topic.id)}
                          aria-label={`Add ${topic.name} to sidebar`}
                          title={`Add ${topic.name} to sidebar`}
                        >
                          <Plus size={18} />
                        </button>
                      )}
                    </div>
                    {isExpanded ? (
                      <div className="bubble-store-detail">
                        <p>{topic.description}</p>
                        {metadata.starters?.length ? (
                          <div className="bubble-store-starters">
                            {metadata.starters.slice(0, 3).map((starter) => (
                              <button key={starter} type="button" onClick={() => onSelect(topic.id)}>
                                <Sparkles size={13} />
                                {starter}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

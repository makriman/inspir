"use client";

import { useState } from "react";
import { Check, Minus, Plus, Search, Sparkles } from "lucide-react";
import {
  learningFeatureCategory,
  searchTopics,
  storeTopicMetadata,
  type LearningStoreTopic,
} from "@/components/chat/learning-store-utils";

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
  const [expandedTopicId, setExpandedTopicId] = useState("");
  const openTopicId = expandedTopicId || activeTopicId;
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
    <main className="inspir-learning-store app-scrollbar">
      <section className="inspir-store-head">
        <div>
          <span>Learning Store</span>
          <h2>Choose what lives in your sidebar.</h2>
          <p>Search every chat mode and mini app, open details, and keep your daily tools one click away.</p>
        </div>
        <div className="inspir-store-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search features, tools, subjects, workflows..."
            aria-label="Search learning store"
          />
        </div>
      </section>

      <div className="inspir-store-categories" role="tablist" aria-label="Learning store categories">
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
        <div className="inspir-store-empty">
          <Search size={28} />
          <strong>No matching features</strong>
          <span>Try a broader search like quiz, timer, notes, focus, writing, or science.</span>
        </div>
      ) : null}

      <div className="inspir-store-groups">
        {groups.map((group) => (
          <section key={group.category} className="inspir-store-group">
            <h3>{group.category}</h3>
            <div className="inspir-store-grid">
              {group.topics.map((topic) => {
                const metadata = storeTopicMetadata(topic);
                const isAdded = addedTopicIds.includes(topic.id);
                const isExpanded = openTopicId === topic.id;
                const isActive = activeTopicId === topic.id;
                return (
                  <article
                    key={topic.id}
                    className={`inspir-store-tile ${isAdded ? "is-added" : ""} ${isActive ? "is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="inspir-store-tile-main"
                      onClick={() => setExpandedTopicId(isExpanded ? "" : topic.id)}
                      aria-expanded={isExpanded}
                    >
                      <div className="inspir-store-tile-top">
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
                    <div className="inspir-store-tile-actions">
                      <button
                        type="button"
                        className="inspir-store-open-button"
                        onClick={() => onSelect(topic.id)}
                      >
                        Open
                      </button>
                      {isAdded ? (
                        <button
                          type="button"
                          className="inspir-store-remove-button"
                          onClick={() => onRemove(topic.id)}
                          aria-label={`Remove ${topic.name} from sidebar`}
                          title={`Remove ${topic.name} from sidebar`}
                        >
                          <Minus size={18} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="inspir-store-add-button"
                          onClick={() => onAdd(topic.id)}
                          aria-label={`Add ${topic.name} to sidebar`}
                          title={`Add ${topic.name} to sidebar`}
                        >
                          <Plus size={18} />
                        </button>
                      )}
                    </div>
                    {isExpanded ? (
                      <div className="inspir-store-detail">
                        <p>{topic.description}</p>
                        {metadata.starters?.length ? (
                          <div className="inspir-store-starters">
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

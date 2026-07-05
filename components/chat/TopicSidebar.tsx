import Image from "next/image";
import { Check, Plus, Search } from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { GoogleContinueButton } from "@/components/marketing/SignInButton";
import { topicPath } from "@/lib/content/topic-routing";
import { localizeHref } from "@/lib/i18n/routing";
import { topicMetadata, type Topic } from "@/components/chat/topic-model";

type TopicSidebarProps = {
  isGuest: boolean;
  avatarSrc?: string;
  topics: Topic[];
  sidebarTopics: Topic[];
  filteredTopics: Topic[];
  currentLanguage: string;
  activeTopicId: string;
  addedTopicIds: string[];
  search: string;
  onAddFeature: (topicId: string) => void;
  onOpenStore: () => void;
  onProfile: () => void;
  onSearch: (value: string) => void;
  onSelect: (topicId: string) => void;
};

export function TopicSidebar({
  isGuest,
  avatarSrc,
  topics,
  sidebarTopics,
  filteredTopics,
  currentLanguage,
  activeTopicId,
  addedTopicIds,
  search,
  onAddFeature,
  onOpenStore,
  onProfile,
  onSearch,
  onSelect,
}: TopicSidebarProps) {
  const activeTopic = topics.find((topic) => topic.id === activeTopicId);
  const rows = search ? filteredTopics : sidebarTopics;
  const groups = rows.reduce<Array<{ category: string; topics: Topic[] }>>((acc, topic) => {
    const category = topicMetadata(topic)?.category ?? "Learning";
    const existing = acc.find((group) => group.category === category);
    if (existing) existing.topics.push(topic);
    else acc.push({ category, topics: [topic] });
    return acc;
  }, []);

  return (
    <div className="inspir-sidebar-inner">
      <div className="inspir-sidebar-header">
        {isGuest ? (
          <GoogleContinueButton
            className="inspir-guest-auth-button"
            callbackUrl={localizeHref(activeTopic ? topicPath(activeTopic.slug) : "/chat", currentLanguage)}
          >
            Continue with Google
          </GoogleContinueButton>
        ) : (
          <button type="button" onClick={onProfile} aria-label="Open profile" className="inspir-avatar-button">
            {avatarSrc ? (
              <Image src={avatarSrc} alt="" width={40} height={40} sizes="40px" unoptimized />
            ) : null}
          </button>
        )}
        <InspirLogo className="inspir-sidebar-logo" />
        <button
          type="button"
          onClick={onOpenStore}
          aria-label="Open learning store"
          title="Open learning store"
          className="inspir-sidebar-store-button"
        >
          <Plus size={20} />
        </button>
      </div>
      <div className="inspir-search-row">
        <div className="inspir-search-shell">
          <input
            aria-label="Search chats"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search"
            className="inspir-search-input"
          />
          {search ? <Search className="inspir-search-icon" size={16} /> : null}
        </div>
      </div>
      <div className="inspir-topic-list app-scrollbar">
        {search && filteredTopics.length === 0 ? (
          <div className="inspir-no-results">No search results</div>
        ) : null}
        {!search && rows.length === 0 && activeTopic ? (
          <button
            type="button"
            onClick={() => onSelect(activeTopic.id)}
            className={`inspir-topic-row ${activeTopic.id === activeTopicId ? "is-active" : ""}`}
          >
            <span className="inspir-topic-title">{activeTopic.name}</span>
            <span className="inspir-topic-subtitle">{activeTopic.subText}</span>
          </button>
        ) : null}
        {groups.map((group) => (
          <section key={group.category} className="inspir-topic-group">
            <h3>{group.category}</h3>
            {group.topics.map((topic) => {
              const isAdded = addedTopicIds.includes(topic.id);
              return (
                <div key={topic.id} className="inspir-topic-row-shell">
                  <button
                    type="button"
                    onClick={() => onSelect(topic.id)}
                    className={`inspir-topic-row ${search ? "has-sidebar-action" : ""} ${
                      topic.id === activeTopicId ? "is-active" : ""
                    }`}
                  >
                    <span className="inspir-topic-title">{topic.name}</span>
                    <span className="inspir-topic-subtitle">{topic.subText}</span>
                  </button>
                  {search ? (
                    isAdded ? (
                      <span className="inspir-topic-row-action is-added" aria-label={`${topic.name} is added`}>
                        <Check size={16} />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onAddFeature(topic.id);
                        }}
                        className="inspir-topic-row-action"
                        aria-label={`Add ${topic.name} to sidebar`}
                        title={`Add ${topic.name} to sidebar`}
                      >
                        <Plus size={16} />
                      </button>
                    )
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

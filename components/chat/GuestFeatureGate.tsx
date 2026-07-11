import { Sparkles } from "lucide-react";
import { TopicIntroCard } from "@/components/chat/TopicIntroCard";
import { defaultTopicWorkspacePath } from "@/lib/content/topic-path";

export function GuestFeatureGate({
  category,
  description,
  featureName,
  name,
  starters,
  topicHref,
}: {
  category: string;
  description: string;
  featureName: string;
  name: string;
  starters: string[];
  topicHref: string;
}) {
  return (
    <main className="inspir-workspace">
      <section className="inspir-guest-feature-gate">
        <TopicIntroCard category={category} name={name} description={description} />
        <div className="inspir-guest-feature-card">
          <Sparkles size={26} />
          <span>Continue learning</span>
          <h2>{featureName}</h2>
          <p>{description}</p>
          <a className="inspir-guest-modal-primary" href={defaultTopicWorkspacePath()}>
            Learn Anything
          </a>
        </div>
        {starters.length ? (
          <div className="inspir-starter-grid">
            {starters.map((starter) => (
              <a key={starter} href={topicHref}>
                <Sparkles size={16} />
                <span>{starter}</span>
              </a>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

import { Sparkles } from "lucide-react";
import { TopicIntroCard } from "@/components/chat/TopicIntroCard";
import { GoogleContinueButton } from "@/components/marketing/SignInButton";

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
          <span>Sign in to keep learning</span>
          <h2>Continue with Google to use {featureName}.</h2>
          <p>Sign in keeps your progress, score, generated activities, and future conversations saved.</p>
          <GoogleContinueButton className="inspir-guest-modal-primary" callbackUrl={topicHref}>
            Continue with Google
          </GoogleContinueButton>
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

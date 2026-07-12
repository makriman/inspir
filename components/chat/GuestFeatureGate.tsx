import { Sparkles } from "lucide-react";
import { TopicIntroCard } from "@/components/chat/TopicIntroCard";
import { GoogleContinueButton } from "@/components/marketing/SignInButton";

export function GuestFeatureGate({
  category,
  description,
  name,
  starters,
  t,
  topicHref,
}: {
  category: string;
  description: string;
  name: string;
  starters: string[];
  t: (source: string) => string;
  topicHref: string;
}) {
  return (
    <main className="inspir-workspace">
      <section className="inspir-guest-feature-gate">
        <TopicIntroCard category={category} name={name} description={description} />
        <div className="inspir-guest-feature-card">
          <Sparkles size={26} />
          <span>{t("Sign in to keep learning")}</span>
          <h2>{t("Continue learning")}</h2>
          <p>{t("Easy Google login, then inspir stores your learning history, language preference, and chats so everything is ready next time. inspir stays free to use.")}</p>
          <GoogleContinueButton
            className="inspir-guest-modal-primary"
            callbackUrl={topicHref}
            errorMessage={t("We could not sign you in. Please try again.")}
          >
            {t("Continue with Google")}
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

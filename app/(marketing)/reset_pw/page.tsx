import type { Metadata } from "next";
import { GoogleContinueButton } from "@/components/marketing/SignInButton";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";

const pageMetadata: Metadata = {
  title: "Account sign-in",
  description: "Inspir accounts use Google sign-in, so there is no separate password to reset.",
  robots: { index: false, follow: false, nocache: true },
};

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/reset_pw");
}

export default function ResetPasswordPage() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <section className="marketing-auth-page" aria-labelledby="reset-password-title">
        <div className="marketing-auth-panel">
          <span>Account</span>
          <h1 id="reset-password-title">There is no inspir password to reset</h1>
          <p className="marketing-auth-copy">
            Inspir accounts sign in with Google. If you reached this page from an old reset link, use Google to continue
            back to your learning history.
          </p>
          <p className="marketing-auth-copy">
            To recover access, use the same Google account you used before. Password recovery is handled by Google, not
            by inspir.
          </p>
          <GoogleContinueButton className="marketing-auth-action" callbackUrl="/chat">
            Continue with Google
          </GoogleContinueButton>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}

import type { Metadata } from "next";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import { metadataAlternates } from "@/lib/seo/config";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Set a new inspir password from a secure account reset link.",
  alternates: metadataAlternates("/reset_pw"),
  robots: { index: false, follow: false, nocache: true },
};

export default function ResetPasswordPage() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <section className="marketing-auth-page" aria-labelledby="reset-password-title">
        <div className="marketing-auth-panel">
          <span>Account</span>
          <h1 id="reset-password-title">Reset your password</h1>
          <p className="marketing-auth-copy">
            Use the secure reset link from your email, then choose a new password for your account.
          </p>
          <form className="marketing-form">
            <label>
              New password
              <input type="password" placeholder="********" autoComplete="new-password" />
            </label>
            <label>
              Confirm new password
              <input type="password" placeholder="********" autoComplete="new-password" />
            </label>
            <button type="button">Confirm</button>
          </form>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}

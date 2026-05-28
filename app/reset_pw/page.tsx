import type { Metadata } from "next";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <section className="marketing-auth-page" aria-labelledby="reset-password-title">
        <div className="marketing-auth-panel">
          <span>Account</span>
          <h1 id="reset-password-title">Reset your password</h1>
          <form className="marketing-form">
            <label>
              New password
              <input type="password" placeholder="********" />
            </label>
            <label>
              Confirm new password
              <input type="password" placeholder="********" />
            </label>
            <button type="button">Confirm</button>
          </form>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}

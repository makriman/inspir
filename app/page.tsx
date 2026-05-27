import Link from "next/link";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { SignInButton } from "@/components/marketing/SignInButton";

export default function LandingPage() {
  return (
    <main className="landing-bubble">
      <InspirLogo className="landing-logo" />
      <section className="landing-hero" aria-labelledby="landing-title">
        <h1 id="landing-title" className="landing-title">
          <span>Revolutionize Your Learning Journey with</span>
          <span>Artificial intelligence</span>
        </h1>
        <SignInButton />
      </section>
      <footer className="landing-footer">
        <nav className="landing-legal-links">
          <Link href="/tnc">Terms and Conditions</Link>
          <Link href="/privacy">Privacy Policy</Link>
        </nav>
        <nav className="landing-mission-link">
          <Link href="/mission">Read our Mission Statement</Link>
        </nav>
        <SocialLinks className="landing-social-links" />
      </footer>
    </main>
  );
}

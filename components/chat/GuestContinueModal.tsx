import { X } from "lucide-react";
import { GoogleContinueButton } from "@/components/marketing/SignInButton";

export function GuestContinueModal({
  used,
  limit,
  callbackUrl,
  onClose,
}: {
  used: number;
  limit: number;
  callbackUrl: string;
  onClose: () => void;
}) {
  return (
    <div className="inspir-guest-modal-backdrop" role="presentation">
      <dialog open className="inspir-guest-modal" aria-modal="true" aria-labelledby="guest-modal-title">
        <button type="button" onClick={onClose} aria-label="Close" className="inspir-guest-modal-close">
          <X size={20} />
        </button>
        <span className="inspir-guest-modal-kicker">
          {Math.min(used, limit)}/{limit} free guest messages used
        </span>
        <h2 id="guest-modal-title">Continue learning</h2>
        <p>
          Easy Google login, then inspir stores your learning history, language preference, and chats so everything is
          ready next time. inspir stays free to use.
        </p>
        <GoogleContinueButton className="inspir-guest-modal-primary" callbackUrl={callbackUrl}>
          Continue with Google
        </GoogleContinueButton>
        <button type="button" onClick={onClose} className="inspir-guest-modal-secondary">
          Maybe later
        </button>
      </dialog>
    </div>
  );
}

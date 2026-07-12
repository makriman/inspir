import { X } from "lucide-react";
import { GoogleContinueButton } from "@/components/marketing/SignInButton";

export function GuestContinueModal({
  used,
  limit,
  callbackUrl,
  t,
  onClose,
}: {
  used: number;
  limit: number;
  callbackUrl: string;
  t: (source: string) => string;
  onClose: () => void;
}) {
  return (
    <div className="inspir-guest-modal-backdrop" role="presentation">
      <dialog open className="inspir-guest-modal" aria-modal="true" aria-labelledby="guest-modal-title">
        <button type="button" onClick={onClose} aria-label={t("Close")} className="inspir-guest-modal-close">
          <X size={20} />
        </button>
        <span className="inspir-guest-modal-kicker">
          {Math.min(used, limit)}/{limit} {t("free guest messages used")}
        </span>
        <h2 id="guest-modal-title">{t("Continue learning")}</h2>
        <p>{t("Easy Google login, then inspir stores your learning history, language preference, and chats so everything is ready next time. inspir stays free to use.")}</p>
        <GoogleContinueButton
          className="inspir-guest-modal-primary"
          callbackUrl={callbackUrl}
          errorMessage={t("We could not sign you in. Please try again.")}
        >
          {t("Continue with Google")}
        </GoogleContinueButton>
        <button type="button" onClick={onClose} className="inspir-guest-modal-secondary">
          {t("Maybe later")}
        </button>
      </dialog>
    </div>
  );
}

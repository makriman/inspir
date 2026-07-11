import { X } from "lucide-react";

export function GuestContinueModal({
  used,
  limit,
  onClose,
}: {
  used: number;
  limit: number;
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
        <button type="button" onClick={onClose} className="inspir-guest-modal-secondary">
          Maybe later
        </button>
      </dialog>
    </div>
  );
}

import { ArrowLeft, History, Menu, RefreshCw, RotateCcw, Square } from "lucide-react";

type TopBarProps = {
  title: string;
  recentOpen: boolean;
  showRecent: boolean;
  sending: boolean;
  canRegenerate: boolean;
  onReset: () => void;
  onRecent: () => void;
  onBack: () => void;
  onMenu: () => void;
  onStop: () => void;
  onRegenerate: () => void;
  showSessionActions?: boolean;
};

export function TopBar({
  title,
  recentOpen,
  showRecent,
  sending,
  canRegenerate,
  onReset,
  onRecent,
  onBack,
  onMenu,
  onStop,
  onRegenerate,
  showSessionActions = true,
}: TopBarProps) {
  return (
    <header className="inspir-topbar">
      <button type="button" onClick={onMenu} className="inspir-mobile-menu" aria-label="Open topics">
        <Menu size={26} />
      </button>
      <div className="inspir-topbar-title">
        {recentOpen ? (
          <button type="button" onClick={onBack} aria-label="Back to chat" className="inspir-back-button">
            <ArrowLeft size={22} />
          </button>
        ) : null}
        <span>{title}</span>
      </div>
      <div className="inspir-topbar-actions">
        {showSessionActions ? (
          <>
            <button type="button" onClick={onReset} aria-label="Reset conversation" className="inspir-reset-button">
              <RotateCcw size={25} strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={sending ? onStop : onRegenerate}
              disabled={!sending && !canRegenerate}
              aria-label={sending ? "Stop response" : "Regenerate response"}
              className="inspir-regenerate-button"
            >
              {sending ? <Square size={18} fill="currentColor" /> : <RefreshCw size={24} strokeWidth={3} />}
            </button>
            {showRecent ? (
              <button type="button" onClick={onRecent} aria-label="Recent conversations" className="inspir-history-button">
                <History size={26} strokeWidth={3} />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </header>
  );
}

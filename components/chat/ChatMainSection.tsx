import type { ReactNode } from "react";
import { TopBar } from "@/components/chat/TopBar";

type ChatMainSectionProps = {
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
  showSessionActions: boolean;
  children: ReactNode;
};

export function ChatMainSection({
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
  showSessionActions,
  children,
}: ChatMainSectionProps) {
  return (
    <section className="inspir-main-shell">
      <TopBar
        title={title}
        recentOpen={recentOpen}
        showRecent={showRecent}
        sending={sending}
        canRegenerate={canRegenerate}
        onReset={onReset}
        onRecent={onRecent}
        onBack={onBack}
        onMenu={onMenu}
        onStop={onStop}
        onRegenerate={onRegenerate}
        showSessionActions={showSessionActions}
      />
      {children}
    </section>
  );
}

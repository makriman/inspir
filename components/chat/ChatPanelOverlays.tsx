"use client";

import { AgePromptModal } from "@/components/chat/AgePromptModal";
import { GuestContinueModal } from "@/components/chat/GuestContinueModal";
import { MemorySourcesModal } from "@/components/chat/MemorySourcesModal";
import type { MessageMemorySource } from "@/components/chat/chat-message-model";
import { PersistentLearningDock } from "@/components/chat/PersistentLearningDock";
import type { PersistentLearningToolsController } from "@/components/chat/PersistentLearningTools";
import type { UserProfile } from "@/components/chat/profile-model";
import { defaultLanguage } from "@/lib/content/languages";

type MemorySourceModalState = {
  messageId: string;
  sources: MessageMemorySource[];
} | null;

type ChatPanelOverlaysProps = {
  agePromptOpen: boolean;
  guestMessageLimit: number;
  guestMessagesUsed: number;
  guestPromptOpen: boolean;
  isGuest: boolean;
  learningTools: PersistentLearningToolsController;
  memorySourceModal: MemorySourceModalState;
  profileUser: UserProfile;
  onAgePromptOpen: (open: boolean) => void;
  onGuestPromptOpen: (open: boolean) => void;
  onMemorySourceFeedback: (
    source: MessageMemorySource,
    action: "relevant" | "not_relevant" | "dont_mention",
  ) => void;
  onMemorySourceModal: (modal: MemorySourceModalState) => void;
  onOpenMusic: () => void;
  onOpenTimer: () => void;
  onProfileUser: (user: UserProfile) => void;
  t: (source: string) => string;
};

export function ChatPanelOverlays({
  agePromptOpen,
  guestMessageLimit,
  guestMessagesUsed,
  guestPromptOpen,
  isGuest,
  learningTools,
  memorySourceModal,
  profileUser,
  onAgePromptOpen,
  onGuestPromptOpen,
  onMemorySourceFeedback,
  onMemorySourceModal,
  onOpenMusic,
  onOpenTimer,
  onProfileUser,
  t,
}: ChatPanelOverlaysProps) {
  return (
    <>
      <PersistentLearningDock tools={learningTools} onOpenTimer={onOpenTimer} onOpenMusic={onOpenMusic} />
      {isGuest && guestPromptOpen ? (
        <GuestContinueModal
          used={guestMessagesUsed}
          limit={guestMessageLimit}
          onClose={() => onGuestPromptOpen(false)}
        />
      ) : null}
      {!isGuest && agePromptOpen && !profileUser.dateOfBirth ? (
        <AgePromptModal
          initialLanguage={profileUser.preferredLanguage || defaultLanguage}
          onClose={() => onAgePromptOpen(false)}
          onSaved={(updatedUser) => {
            onProfileUser(updatedUser);
            onAgePromptOpen(false);
          }}
          t={t}
        />
      ) : null}
      {memorySourceModal ? (
        <MemorySourcesModal
          sources={memorySourceModal.sources}
          onClose={() => onMemorySourceModal(null)}
          onFeedback={onMemorySourceFeedback}
        />
      ) : null}
    </>
  );
}

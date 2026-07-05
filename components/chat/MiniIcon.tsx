import { BookOpenCheck, Clipboard, Compass, Gauge, Landmark } from "lucide-react";
import type { MiniAppIcon } from "@/components/chat/mini-icon-types";

const miniIconComponents = {
  compass: Compass,
  landmark: Landmark,
  lesson: BookOpenCheck,
  collab: Clipboard,
  socratic: Gauge,
} satisfies Record<MiniAppIcon, typeof Compass>;

export function MiniIcon({ icon }: { icon: MiniAppIcon }) {
  const Icon = miniIconComponents[icon];
  return (
    <div className="inspir-mini-icon">
      <Icon size={24} />
    </div>
  );
}

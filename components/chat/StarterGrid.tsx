import { Sparkles } from "lucide-react";

export function StarterGrid({
  starters,
  onStart,
}: {
  starters: string[];
  onStart: (starter: string) => void;
}) {
  if (!starters.length) return null;
  return (
    <div className="inspir-starter-grid">
      {starters.map((starter) => (
        <button key={starter} type="button" onClick={() => onStart(starter)}>
          <Sparkles size={16} />
          <span>{starter}</span>
        </button>
      ))}
    </div>
  );
}

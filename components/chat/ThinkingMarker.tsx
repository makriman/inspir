import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";

export function ThinkingMarker({ label }: { label: string }) {
  return (
    <Marker className="inspir-thinking" aria-live="polite">
      <MarkerIcon className="inspir-thinking-dots">
        <span />
        <span />
        <span />
      </MarkerIcon>
      <MarkerContent>
        <strong>{label}</strong>
      </MarkerContent>
    </Marker>
  );
}

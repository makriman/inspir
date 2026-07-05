export function PendingAssistantBody() {
  return (
    <div className="inspir-pending-assistant" aria-live="polite" aria-label="Thinking">
      <span className="inspir-thinking-dots">
        <span />
        <span />
        <span />
      </span>
      <strong>Thinking</strong>
    </div>
  );
}

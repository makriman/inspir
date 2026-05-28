const miniAppInstructionMarker = "[Mini app instruction]";
const socraticSessionMarker = "[Socratic session start]";
const socraticControlMarker = "[Coach control]";
const visibleLinePrefix = "Visible:";

export function buildMiniAppInstruction({
  visible,
  instructions,
}: {
  visible: string;
  instructions: string;
}) {
  return [
    miniAppInstructionMarker,
    `${visibleLinePrefix} ${visible.replace(/\s+/g, " ").trim()}`,
    "",
    instructions.trim(),
  ].join("\n");
}

export function getVisibleMessageContent(content: string) {
  if (content.startsWith(socraticSessionMarker)) {
    const target = extractLabeledLine(content, "Target input");
    return target ? `Socratic target: ${target}` : "Socratic session";
  }

  if (content.startsWith(socraticControlMarker)) return "Coach control";

  if (!content.startsWith(miniAppInstructionMarker)) return content;
  const visible = content
    .split("\n")
    .find((line) => line.trimStart().startsWith(visibleLinePrefix))
    ?.slice(visibleLinePrefix.length)
    .trim();

  return visible || "";
}

export function isMiniAppInstruction(content: string) {
  return content.startsWith(miniAppInstructionMarker);
}

function extractLabeledLine(content: string, label: string) {
  const match = content.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

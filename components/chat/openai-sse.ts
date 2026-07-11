export type OpenAiSseParseResult = {
  text: string;
  remainder: string;
};

export function parseOpenAiSseText(input: string, final = false): OpenAiSseParseResult {
  let cursor = final && input.trim() ? `${input}\n\n` : input;
  let text = "";

  while (true) {
    const match = /\r?\n\r?\n/.exec(cursor);
    if (!match || match.index === undefined) break;
    const rawEvent = cursor.slice(0, match.index);
    cursor = cursor.slice(match.index + match[0].length);
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    text += textDeltaFromEvent(data);
  }

  return { text, remainder: cursor };
}

function textDeltaFromEvent(data: string) {
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed) || !Array.isArray(parsed.choices)) return "";
    const choice = parsed.choices[0];
    if (!isRecord(choice) || !isRecord(choice.delta)) return "";
    return typeof choice.delta.content === "string" ? choice.delta.content : "";
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

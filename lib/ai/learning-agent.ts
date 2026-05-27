import { ToolLoopAgent } from "ai";
import { openai } from "@ai-sdk/openai";

export function createLearningAgent() {
  return new ToolLoopAgent({
    model: openai(process.env.OPENAI_MODEL ?? "gpt-4.1-mini"),
    tools: {},
  });
}

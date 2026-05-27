import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

type BubbleNode = {
  type?: string;
  name?: string;
  properties?: {
    text?: { entries?: Record<string, unknown> };
    top?: number;
    left?: number;
    order?: number;
  };
  elements?: Record<string, BubbleNode>;
};

function textFromExpression(expr?: { entries?: Record<string, unknown> }) {
  const entries = expr?.entries;
  if (!entries) return "";
  return Object.keys(entries)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => (typeof entries[key] === "string" ? entries[key] : ""))
    .join("")
    .replace(/\r\n/g, "\n")
    .trim();
}

function collectText(node: BubbleNode, out: { text: string; top: number; left: number; order: number }[] = []) {
  if (node.type === "Text") {
    const text = textFromExpression(node.properties?.text);
    if (text) {
      out.push({
        text,
        top: node.properties?.top ?? 0,
        left: node.properties?.left ?? 0,
        order: node.properties?.order ?? 0,
      });
    }
  }

  for (const child of Object.values(node.elements ?? {})) {
    collectText(child, out);
  }

  return out;
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const rawPath = join(process.cwd(), "Export from Bubble", "inspir-learning (1).bubble");
const bubble = JSON.parse(readFileSync(rawPath, "utf8")) as { pages: Record<string, BubbleNode> };

function pageByName(name: string) {
  const page = Object.values(bubble.pages).find((entry) => entry.name === name);
  if (!page) throw new Error(`Missing Bubble page: ${name}`);
  return page;
}

const pages = Object.fromEntries(
  ["tnc", "privacy", "mission"].map((name) => {
    const blocks = uniqueInOrder(
      collectText(pageByName(name))
        .sort((a, b) => a.top - b.top || a.left - b.left || a.order - b.order)
        .map((entry) => entry.text),
    );
    return [name, blocks];
  }),
);

const moduleText = `export const extractedPages = ${JSON.stringify(pages, null, 2)} as const;\n`;
writeFileSync(join(process.cwd(), "lib", "content", "extracted-pages.ts"), moduleText);

"use client";

import {
  ComponentPropsWithoutRef,
  Fragment,
  isValidElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckCircle2, Copy } from "lucide-react";
import { highlightElement, type ShjLanguage } from "@speed-highlight/core";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type RichMarkdownContentProps = {
  content: string;
  className?: string;
  streaming?: boolean;
};

const supportedCodeLanguages = new Set([
  "asm",
  "bash",
  "bf",
  "c",
  "css",
  "csv",
  "diff",
  "docker",
  "git",
  "go",
  "html",
  "http",
  "ini",
  "java",
  "js",
  "jsdoc",
  "json",
  "leanpub-md",
  "log",
  "lua",
  "make",
  "md",
  "pl",
  "plain",
  "py",
  "regex",
  "rs",
  "sql",
  "todo",
  "toml",
  "ts",
  "uri",
  "xml",
  "yaml",
]);

const codeLanguageAliases: Record<string, ShjLanguage> = {
  cjs: "js",
  console: "bash",
  dockerfile: "docker",
  javascript: "js",
  jsx: "js",
  markdown: "md",
  mdx: "md",
  node: "js",
  plaintext: "plain",
  powershell: "bash",
  python: "py",
  shell: "bash",
  sh: "bash",
  text: "plain",
  tsx: "ts",
  typescript: "ts",
  yml: "yaml",
  zsh: "bash",
};

const richMarkdownComponents: Components = {
  table: ({ children }) => (
    <div className="inspir-table-wrap">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <>{children}</>,
  code: MarkdownCode,
};

export function RichMarkdownContent({
  content,
  className = "inspir-rich-content",
  streaming = false,
}: RichMarkdownContentProps) {
  if (streaming) {
    return <StreamingMarkdownPreview content={content} className={className} />;
  }

  return (
    <div className={className} data-no-auto-translate="true">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={richMarkdownComponents}
      >
        {normalizeAssistantMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

type StreamingMarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; code: string }
  | { type: "table"; rows: string[][] };

function StreamingMarkdownPreview({ content, className }: { content: string; className: string }) {
  const blocks = useMemo(() => parseStableStreamingMarkdown(content), [content]);

  return (
    <div className={`${className} is-streaming`} data-content-length={content.length} data-no-auto-translate="true">
      {blocks.length > 0
        ? keyedStreamingBlocks(blocks).map(({ key, block }) => (
            <div key={key} className="inspir-stream-block" data-stream-block={key}>
              <StreamingBlock block={block} />
            </div>
          ))
        : null}
    </div>
  );
}

function parseStableStreamingMarkdown(content: string) {
  const normalized = normalizeAssistantMarkdown(content).replace(/\r\n?/g, "\n");
  const openFenceStart = findOpenFenceStart(normalized);
  if (openFenceStart !== null) {
    return [
      ...parseStreamingMarkdown(normalized.slice(0, openFenceStart)),
      ...parseStreamingMarkdownTail(normalized.slice(openFenceStart)),
    ];
  }

  const stableBoundary = lastStableBlockBoundary(normalized);
  return [
    ...parseStreamingMarkdown(normalized.slice(0, stableBoundary)),
    ...parseStreamingMarkdownTail(normalized.slice(stableBoundary)),
  ];
}

function findOpenFenceStart(content: string) {
  const lines = content.split("\n");
  let offset = 0;
  let openStart: number | null = null;

  for (const line of lines) {
    if (/^\s*```[\w-]*\s*$/.test(line)) {
      openStart = openStart === null ? offset : null;
    }
    offset += line.length + 1;
  }

  return openStart;
}

function lastStableBlockBoundary(content: string) {
  let boundary = 0;
  const paragraphBreak = /\n[ \t]*\n/g;
  let match: RegExpExecArray | null;
  while ((match = paragraphBreak.exec(content)) !== null) {
    boundary = match.index + match[0].length;
  }
  return boundary;
}

function parseStreamingMarkdownTail(content: string): StreamingMarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  const firstLine = nonEmptyLines[0] ?? "";

  if (!firstLine) return [];
  if (/^`{1,2}[\w-]*\s*$/.test(firstLine)) {
    return [{ type: "code", language: firstLine.replace(/^`{1,2}/, "").trim(), code: "" }];
  }
  if (/^```[\w-]*\s*$/.test(firstLine) || /^#{1,6}\s+/.test(firstLine)) {
    return parseStreamingMarkdown(content);
  }
  const heading = firstLine.match(/^(#{1,6})(?:\s+(.*)|\s*)$/);
  if (heading) {
    return [
      {
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: heading[2] ?? "",
      },
    ];
  }
  if (nonEmptyLines.every((line) => line.includes("|"))) {
    return [{ type: "table", rows: parseMarkdownTableRows(nonEmptyLines) }];
  }
  if (nonEmptyLines.every((line) => /^[-*+](?:\s+.*)?$/.test(line))) {
    return [
      {
        type: "list",
        ordered: false,
        items: nonEmptyLines.map((line) => line.replace(/^[-*+]\s*/, "")),
      },
    ];
  }
  if (nonEmptyLines.every((line) => /^\d+[.)](?:\s+.*)?$/.test(line))) {
    return [
      {
        type: "list",
        ordered: true,
        items: nonEmptyLines.map((line) => line.replace(/^\d+[.)]\s*/, "")),
      },
    ];
  }
  if (nonEmptyLines.every((line) => line.startsWith(">"))) {
    return [
      {
        type: "blockquote",
        lines: nonEmptyLines.map((line) => line.replace(/^>\s?/, "")).filter(Boolean),
      },
    ];
  }

  return [{ type: "paragraph", lines: nonEmptyLines }];
}

function parseStreamingMarkdown(content: string): StreamingMarkdownBlock[] {
  const lines = normalizeAssistantMarkdown(content).replace(/\r\n?/g, "\n").split("\n");
  const blocks: StreamingMarkdownBlock[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    const linesToFlush: string[] = [];
    for (const line of paragraphLines) {
      const trimmed = line.trim();
      if (trimmed) linesToFlush.push(trimmed);
    }
    if (linesToFlush.length > 0) blocks.push({ type: "paragraph", lines: linesToFlush });
    paragraphLines = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const fence = trimmed.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      const codeLines: string[] = [];
      for (index += 1; index < lines.length; index += 1) {
        const codeLine = lines[index] ?? "";
        if (codeLine.trim() === "```") break;
        codeLines.push(codeLine);
      }
      blocks.push({ type: "code", language: fence[1] ?? "", code: codeLines.join("\n").replace(/\n$/, "") });
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      flushParagraph();
      const tableLines: string[] = [];
      for (; index < lines.length; index += 1) {
        const tableLine = lines[index]?.trim() ?? "";
        if (!tableLine || !tableLine.includes("|")) break;
        tableLines.push(tableLine);
      }
      index -= 1;
      blocks.push({ type: "table", rows: parseMarkdownTableRows(tableLines) });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, text: heading[2] });
      continue;
    }

    const unorderedItems = collectListItems(lines, index, false);
    if (unorderedItems) {
      flushParagraph();
      blocks.push({ type: "list", ordered: false, items: unorderedItems.items });
      index = unorderedItems.endIndex;
      continue;
    }

    const orderedItems = collectListItems(lines, index, true);
    if (orderedItems) {
      flushParagraph();
      blocks.push({ type: "list", ordered: true, items: orderedItems.items });
      index = orderedItems.endIndex;
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      const quoteLines: string[] = [];
      for (; index < lines.length; index += 1) {
        const quoteLine = lines[index]?.trim() ?? "";
        if (!quoteLine.startsWith(">")) break;
        quoteLines.push(quoteLine.replace(/^>\s?/, ""));
      }
      index -= 1;
      blocks.push({ type: "blockquote", lines: quoteLines.filter(Boolean) });
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

function collectListItems(lines: string[], startIndex: number, ordered: boolean) {
  const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
  const items: string[] = [];
  let index = startIndex;
  for (; index < lines.length; index += 1) {
    const match = lines[index]?.match(pattern);
    if (!match) break;
    items.push(match[1].trim());
  }
  return items.length > 0 ? { items, endIndex: index - 1 } : null;
}

function isMarkdownTableStart(lines: string[], index: number) {
  const current = lines[index]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  return current.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next);
}

function parseMarkdownTableRows(lines: string[]) {
  const rows: string[][] = [];
  for (const line of lines) {
    const row = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

function StreamingBlock({ block }: { block: StreamingMarkdownBlock }) {
  switch (block.type) {
    case "heading":
      return <StreamingHeading block={block} />;
    case "paragraph":
      return (
        <p>
          {keyedTextValues(block.lines).map(({ key, value: line }, lineIndex) => (
            <span key={key}>
              {lineIndex > 0 ? <br /> : null}
              <InlineMarkdown text={line} />
            </span>
          ))}
        </p>
      );
    case "blockquote":
      return (
        <blockquote>
          {keyedTextValues(block.lines).map(({ key, value: line }, lineIndex) => (
            <Fragment key={key}>
              {lineIndex > 0 ? " " : null}
              <InlineMarkdown text={line} />
            </Fragment>
          ))}
        </blockquote>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List>
          {keyedTextValues(block.items).map(({ key, value: item }) => (
            <li key={key}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        <div className="inspir-table-wrap">
          <table>
            <thead>
              <tr>
                {keyedTextValues(block.rows[0] ?? []).map(({ key, value: cell }) => (
                  <th key={key}>
                    <InlineMarkdown text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keyedTableRows(block.rows.slice(2)).map(({ key: rowKey, row }) => (
                <tr key={rowKey}>
                  {keyedTextValues(row).map(({ key, value: cell }) => (
                    <td key={key}>
                      <InlineMarkdown text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <figure className="inspir-code-block is-streaming">
          <figcaption>
            <span>{block.language.trim() || "code"}</span>
          </figcaption>
          <pre>
            <code className="inspir-code-code">{block.code}</code>
          </pre>
        </figure>
      );
  }
}

function StreamingHeading({
  block,
}: {
  block: Extract<StreamingMarkdownBlock, { type: "heading" }>;
}) {
  const children = <InlineMarkdown text={block.text} />;
  switch (block.level) {
    case 1:
      return <h1>{children}</h1>;
    case 2:
      return <h2>{children}</h2>;
    case 3:
      return <h3>{children}</h3>;
    case 4:
      return <h4>{children}</h4>;
    case 5:
      return <h5>{children}</h5>;
    case 6:
      return <h6>{children}</h6>;
  }
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarkdownParts(text).map((part) => {
        if (part.type === "code") return <code key={part.key}>{part.text}</code>;
        if (part.type === "strong") return <strong key={part.key}>{part.text}</strong>;
        return <Fragment key={part.key}>{part.text}</Fragment>;
      })}
    </>
  );
}

type InlineMarkdownPart = {
  key: string;
  type: "text" | "code" | "strong";
  text: string;
};

function parseInlineMarkdownParts(text: string): InlineMarkdownPart[] {
  const parts: InlineMarkdownPart[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushInlineMarkdownPart(parts, "text", text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      pushInlineMarkdownPart(parts, "code", token.slice(1, -1));
    } else {
      pushInlineMarkdownPart(parts, "strong", token.slice(2, -2));
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) pushInlineMarkdownPart(parts, "text", text.slice(lastIndex));
  return parts;
}

function pushInlineMarkdownPart(
  parts: InlineMarkdownPart[],
  type: InlineMarkdownPart["type"],
  text: string,
) {
  parts.push({ key: `${type}-${parts.length}`, type, text });
}

function keyedStreamingBlocks(blocks: StreamingMarkdownBlock[]) {
  const keyedBlocks: Array<{ key: string; block: StreamingMarkdownBlock }> = [];
  let ordinal = 0;
  for (const block of blocks) {
    keyedBlocks.push({ key: `block-${ordinal}`, block });
    ordinal += 1;
  }
  return keyedBlocks;
}

function keyedTextValues(values: string[]) {
  const keyedValues: Array<{ key: string; value: string }> = [];
  let ordinal = 0;
  for (const value of values) {
    keyedValues.push({ key: `text-${ordinal}`, value });
    ordinal += 1;
  }
  return keyedValues;
}

function keyedTableRows(rows: string[][]) {
  const keyedRows: Array<{ key: string; row: string[] }> = [];
  let ordinal = 0;
  for (const row of rows) {
    keyedRows.push({ key: `row-${ordinal}`, row });
    ordinal += 1;
  }
  return keyedRows;
}

function MarkdownCode({ children, className, node, ...props }: ComponentPropsWithoutRef<"code"> & { node?: unknown }) {
  const rawCode = reactNodeToText(children);
  const code = rawCode.replace(/\n$/, "");
  const requestedLanguage = languageFromClassName(className);
  const isBlock =
    Boolean(requestedLanguage) ||
    rawCode.includes("\n") ||
    hasMultiLineSourcePosition(node);

  if (!isBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return <CodeBlock code={code} requestedLanguage={requestedLanguage} />;
}

function CodeBlock({
  code,
  requestedLanguage,
}: {
  code: string;
  requestedLanguage: string | null;
}) {
  const codeRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const syntaxLanguage = normalizeCodeLanguage(requestedLanguage) ?? "plain";
  const displayLanguage = requestedLanguage?.trim() || "code";

  useEffect(() => {
    const element = codeRef.current;
    if (!element) return;

    element.textContent = code;
    void highlightElement(element, syntaxLanguage, "multiline", {
      hideLineNumbers: code.split("\n").length < 2,
    }).catch(() => {
      element.textContent = code;
    });
  }, [code, syntaxLanguage]);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <figure className="inspir-code-block">
      <figcaption>
        <span>{displayLanguage}</span>
        <button type="button" onClick={() => void copyCode()} aria-label="Copy code" title="Copy code">
          {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
        </button>
      </figcaption>
      <pre>
        <code ref={codeRef} className={`inspir-code-code shj-lang-${syntaxLanguage}`}>
          {code}
        </code>
      </pre>
    </figure>
  );
}

function normalizeAssistantMarkdown(content: string) {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression: string) => `\n\n$$\n${expression.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression: string) => `$${expression.trim()}$`);
}

function languageFromClassName(className: string | undefined) {
  return className?.match(/language-([\w-]+)/)?.[1] ?? null;
}

function normalizeCodeLanguage(language: string | null): ShjLanguage | null {
  if (!language) return null;
  const normalized = language.trim().toLowerCase();
  const aliased = codeLanguageAliases[normalized];
  if (aliased) return aliased;
  return isSupportedCodeLanguage(normalized) ? normalized : null;
}

function isSupportedCodeLanguage(language: string): language is ShjLanguage {
  return supportedCodeLanguages.has(language);
}

function reactNodeToText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return reactNodeToText(node.props.children);
  return "";
}

function hasMultiLineSourcePosition(node: unknown) {
  if (!node || typeof node !== "object" || !("position" in node)) return false;
  const position = (node as { position?: { start?: { line?: number }; end?: { line?: number } } }).position;
  const startLine = position?.start?.line;
  const endLine = position?.end?.line;
  return typeof startLine === "number" && typeof endLine === "number" && endLine > startLine;
}

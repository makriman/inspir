"use client";

import {
  ComponentPropsWithoutRef,
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
    <div className="bubble-table-wrap">
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
  className = "bubble-rich-content",
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
  const blocks = useMemo(() => parseStreamingMarkdown(content), [content]);

  return (
    <div className={`${className} is-streaming`} data-no-auto-translate="true">
      {blocks.length > 0 ? blocks.map((block, index) => renderStreamingBlock(block, index)) : null}
    </div>
  );
}

function parseStreamingMarkdown(content: string): StreamingMarkdownBlock[] {
  const lines = normalizeAssistantMarkdown(content).replace(/\r\n?/g, "\n").split("\n");
  const blocks: StreamingMarkdownBlock[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    const linesToFlush = paragraphLines.map((line) => line.trim()).filter(Boolean);
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
      blocks.push({ type: "table", rows: tableLines.map(parseMarkdownTableRow).filter((row) => row.length > 0) });
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

function parseMarkdownTableRow(line: string) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderStreamingBlock(block: StreamingMarkdownBlock, index: number) {
  switch (block.type) {
    case "heading":
      return renderStreamingHeading(block, index);
    case "paragraph":
      return (
        <p key={index}>
          {block.lines.map((line, lineIndex) => (
            <span key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {renderInlineMarkdown(line)}
            </span>
          ))}
        </p>
      );
    case "blockquote":
      return (
        <blockquote key={index}>
          {block.lines.map((line) => renderInlineMarkdown(line)).reduce(joinWithSpaces, [])}
        </blockquote>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        <div key={index} className="bubble-table-wrap">
          <table>
            <thead>
              <tr>
                {(block.rows[0] ?? []).map((cell, cellIndex) => (
                  <th key={cellIndex}>{renderInlineMarkdown(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(2).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInlineMarkdown(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <figure key={index} className="bubble-code-block is-streaming">
          <figcaption>
            <span>{block.language.trim() || "code"}</span>
          </figcaption>
          <pre>
            <code className="bubble-code-code">{block.code}</code>
          </pre>
        </figure>
      );
  }
}

function renderStreamingHeading(block: Extract<StreamingMarkdownBlock, { type: "heading" }>, key: number) {
  const children = renderInlineMarkdown(block.text);
  switch (block.level) {
    case 1:
      return <h1 key={key}>{children}</h1>;
    case 2:
      return <h2 key={key}>{children}</h2>;
    case 3:
      return <h3 key={key}>{children}</h3>;
    case 4:
      return <h4 key={key}>{children}</h4>;
    case 5:
      return <h5 key={key}>{children}</h5>;
    case 6:
      return <h6 key={key}>{children}</h6>;
  }
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={nodes.length}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={nodes.length}>{token.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function joinWithSpaces(nodes: ReactNode[], lineNodes: ReactNode[], index: number) {
  if (index > 0) nodes.push(" ");
  nodes.push(...lineNodes);
  return nodes;
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
    <figure className="bubble-code-block">
      <figcaption>
        <span>{displayLanguage}</span>
        <button type="button" onClick={() => void copyCode()} aria-label="Copy code" title="Copy code">
          {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
        </button>
      </figcaption>
      <pre>
        <code ref={codeRef} className={`bubble-code-code shj-lang-${syntaxLanguage}`}>
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

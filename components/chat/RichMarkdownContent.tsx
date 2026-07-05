"use client";

import {
  ComponentPropsWithoutRef,
  isValidElement,
  ReactNode,
  useEffect,
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

export function RichMarkdownContent({ content, className = "bubble-rich-content" }: RichMarkdownContentProps) {
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

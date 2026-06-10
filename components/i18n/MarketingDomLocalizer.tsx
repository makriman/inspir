"use client";

import { useEffect, useMemo } from "react";
import { defaultLanguage } from "@/lib/content/languages";
import { localizeHref } from "@/lib/i18n/routing";
import { createTranslationLookup, normalizeTranslationText } from "@/lib/i18n/translation-lookup";

type MarketingDomLocalizerProps = {
  language: string;
  namespaces: string[];
  initialEntries: Array<[string, string]>;
};

const translatableAttributes = ["aria-label", "title", "placeholder", "alt"];

export function MarketingDomLocalizer({ language, namespaces, initialEntries }: MarketingDomLocalizerProps) {
  const textLookup = useMemo(() => createTranslationLookup(initialEntries), [initialEntries]);

  useEffect(() => {
    if (language === defaultLanguage || textLookup.size === 0) return;
    const root = document.querySelector(".marketing-site");
    if (!root) return;

    localizeElement(root, textLookup.translate);
    localizeLinks(root, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof Element) {
            localizeElement(node, textLookup.translate);
            localizeLinks(node, language);
          } else if (node instanceof Text) {
            localizeTextNode(node, textLookup.translate);
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [language, namespaces, textLookup]);

  return null;
}

function localizeLinks(root: Element, language: string) {
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    anchor.setAttribute("href", localizeHref(href, language));
  }
}

function localizeElement(root: Element, translate: (value: string) => string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text) textNodes.push(node);
  }
  textNodes.forEach((node) => localizeTextNode(node, translate));

  for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (shouldSkipElement(element)) continue;
    for (const attr of translatableAttributes) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const translated = translate(value);
      if (translated !== normalizeTranslationText(value)) element.setAttribute(attr, translated);
    }
  }
}

function localizeTextNode(node: Text, translate: (value: string) => string) {
  const parent = node.parentElement;
  if (!parent || shouldSkipElement(parent)) return;
  const value = node.nodeValue ?? "";
  const normalized = normalizeTranslationText(value);
  if (!normalized) return;
  const translated = translate(normalized);
  if (!translated || translated === normalized) return;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  node.nodeValue = `${leading}${translated}${trailing}`;
}

function shouldSkipElement(element: Element) {
  return Boolean(element.closest("[data-no-auto-translate], code, pre, script, style, textarea, select"));
}

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getChatLocaleRedirect,
  parseSupportedChatLanguage,
} from "../lib/i18n/chat-locale-reconciliation";

const chatId = "11111111-1111-4111-8111-111111111111";

test("signed-in chat locale reconciliation preserves the complete chat location", () => {
  assert.deepEqual(getChatLocaleRedirect("/chat?topic=biology", "English", "Urdu"), {
    href: "/ur/chat?topic=biology",
    language: "Urdu",
  });
  assert.deepEqual(
    getChatLocaleRedirect(`/fr/chat/${chatId}?source=recent#memory`, "French", "Urdu"),
    {
      href: `/ur/chat/${chatId}?source=recent#memory`,
      language: "Urdu",
    },
  );
  assert.deepEqual(getChatLocaleRedirect(`/ur/chat?chat=${chatId}`, "Urdu", "English"), {
    href: `/chat?chat=${chatId}`,
    language: "English",
  });
});

test("signed-in chat locale reconciliation fails closed and cannot loop", () => {
  assert.equal(getChatLocaleRedirect("/ur/chat?topic=biology", "Urdu", "Urdu"), null);
  assert.equal(getChatLocaleRedirect("/ur/chat", "English", "Urdu"), null);
  assert.equal(getChatLocaleRedirect("/account", "English", "Urdu"), null);
  assert.equal(getChatLocaleRedirect("https://example.com/chat", "English", "Urdu"), null);
  assert.equal(getChatLocaleRedirect("not a valid URL", "English", "Urdu"), null);
  assert.equal(getChatLocaleRedirect("/chat", "English", "Not supported"), null);
  assert.equal(parseSupportedChatLanguage("Not supported"), null);
});

test("chat bootstrap redirects before private API hydration and language updates sync the locale cookie", () => {
  const bootstrap = fs.readFileSync(
    path.resolve("components/chat/StaticGuestChatBootstrap.tsx"),
    "utf8",
  );
  const chatClient = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");
  const profilePanel = fs.readFileSync(path.resolve("components/chat/ProfilePanel.tsx"), "utf8");

  assert.match(bootstrap, /if \(localeRedirect\) \{[\s\S]*initialMessages: \[\]/);
  assert.match(bootstrap, /setClientLanguagePreferenceCookie\(localeCookieName, authenticatedLanguage\)/);
  assert.match(bootstrap, /window\.location\.replace\(redirect\.href\)/);
  assert.match(chatClient, /setClientLanguagePreferenceCookie\(localeCookieName, updatedLanguage\)/);
  assert.match(
    chatClient,
    /window\.location\.pathname\}\$\{window\.location\.search\}\$\{window\.location\.hash\}/,
  );
  assert.doesNotMatch(profilePanel, /localizeHref/);
});

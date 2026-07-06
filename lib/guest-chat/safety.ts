import type { NextRequest } from "next/server";
import { z } from "zod";

export const guestSessionCookie = "inspir_guest_session";
export const guestUsageCookie = "inspir_guest_messages_used";
export const guestCookieMaxAge = 60 * 60 * 24 * 30;
export const guestUsageCookieMaxAge = 60 * 60 * 24;
const maxGuestHistoryMessages = 12;
export const maxGuestHistoryCharacters = 12_000;

export const guestChatSchema = z
  .object({
    topicId: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(6000),
    preferredLanguage: z.string().trim().min(1).max(80).optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().trim().min(1).max(6000),
        }),
      )
      .max(maxGuestHistoryMessages)
      .optional()
      .default([]),
  })
  .superRefine((value, context) => {
    const totalHistoryCharacters = guestHistoryCharacterCount(value.messages);
    if (totalHistoryCharacters > maxGuestHistoryCharacters) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: `Guest chat history must be ${maxGuestHistoryCharacters} characters or less.`,
      });
    }
  });

type GuestHistoryMessage = z.infer<typeof guestChatSchema>["messages"][number];

export function parseUsage(value: string | undefined, limit: number) {
  const parsed = Number(value ?? "0");
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), limit);
}

export function requestIp(request: NextRequest) {
  return requestIpFromHeaders(request.headers);
}

export function requestIpFromHeaders(headers: Headers) {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    null
  );
}

export async function guestFingerprintKey(request: NextRequest) {
  return guestFingerprintKeyFromHeaders(request.headers, requestIp(request));
}

export async function guestFingerprintKeyFromHeaders(headers: Headers, ip: string | null) {
  const source = [
    ip ? `ip:${ip}` : "ip:unavailable",
    `ua:${coarseHeader(headers.get("user-agent"), 160)}`,
    `al:${coarseHeader(headers.get("accept-language"), 80)}`,
    `platform:${coarseHeader(headers.get("sec-ch-ua-platform"), 40)}`,
  ].join("\n");
  return `guest-chat:fingerprint:${await sha256Hex(source)}`;
}

function guestHistoryCharacterCount(messages: GuestHistoryMessage[]) {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

export function sanitizeGuestHistory(messages: GuestHistoryMessage[]) {
  return messages.slice(-maxGuestHistoryMessages).map((message) =>
    message.role === "assistant"
      ? {
          ...message,
          content: `[Client-provided assistant history, not verified by inspir]\n${message.content}`,
        }
      : message,
  );
}

function coarseHeader(value: string | null, maxLength: number) {
  return (value ?? "unknown").trim().replace(/\s+/g, " ").slice(0, maxLength) || "unknown";
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

"use client";

import type { ReactNode } from "react";

export async function startGoogleSignIn(callbackUrl = "/chat") {
  const response = await fetch("/api/auth/csrf");
  const { csrfToken } = (await response.json()) as { csrfToken: string };
  const form = document.createElement("form");
  form.method = "post";
  form.action = `/api/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "csrfToken";
  input.value = csrfToken;
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
}

export function GoogleContinueButton({
  children = "Continue with Google",
  className = "",
  callbackUrl = "/chat",
}: {
  children?: ReactNode;
  className?: string;
  callbackUrl?: string;
}) {
  return (
    <button type="button" onClick={() => void startGoogleSignIn(callbackUrl)} className={className}>
      {children}
    </button>
  );
}

export function SignInButton({
  label = "Get Started Now",
  className = "landing-cta",
  callbackUrl = "/chat",
}: {
  label?: string;
  className?: string;
  callbackUrl?: string;
}) {

  return (
    <button
      type="button"
      onClick={() => void startGoogleSignIn(callbackUrl)}
      className={className}
    >
      {label}
    </button>
  );
}

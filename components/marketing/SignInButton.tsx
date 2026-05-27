"use client";

export function SignInButton() {
  async function startGoogleSignIn() {
    const response = await fetch("/api/auth/csrf");
    const { csrfToken } = (await response.json()) as { csrfToken: string };
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/api/auth/signin/google?callbackUrl=/chat";

    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "csrfToken";
    input.value = csrfToken;
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
  }

  return (
    <button
      type="button"
      onClick={startGoogleSignIn}
      className="landing-cta"
    >
      Get Started Now
    </button>
  );
}

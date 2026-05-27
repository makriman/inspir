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
      className="h-14 w-full max-w-xl rounded-[7px] bg-[#0500d8] px-6 text-xl font-extrabold text-white transition hover:bg-[#0900ff] focus:outline-none focus:ring-2 focus:ring-white"
    >
      Get Started Now
    </button>
  );
}

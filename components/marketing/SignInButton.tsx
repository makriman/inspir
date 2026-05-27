"use client";

export function SignInButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = "/api/auth/signin/google?callbackUrl=/chat";
      }}
      className="h-14 w-full max-w-xl rounded-[7px] bg-[#0500d8] px-6 text-xl font-extrabold text-white transition hover:bg-[#0900ff] focus:outline-none focus:ring-2 focus:ring-white"
    >
      Get Started Now
    </button>
  );
}

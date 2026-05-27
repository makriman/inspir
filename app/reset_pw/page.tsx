export default function ResetPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-white px-6 text-[#091747]">
      <section className="w-full max-w-md rounded-[8px] bg-white p-8 shadow-[0_20px_60px_rgba(95,98,173,0.25)]">
        <h1 className="mb-8 text-center text-4xl font-bold">Reset your password</h1>
        <form className="space-y-5">
          <label className="block text-sm font-bold">
            New password
            <input
              type="password"
              placeholder="********"
              className="mt-2 h-12 w-full rounded-[5px] border border-black/15 px-3 text-base outline-none focus:border-[#52a8ec] focus:ring-2 focus:ring-[#52a8ec]/25"
            />
          </label>
          <label className="block text-sm font-bold">
            Confirm new password
            <input
              type="password"
              placeholder="********"
              className="mt-2 h-12 w-full rounded-[5px] border border-black/15 px-3 text-base outline-none focus:border-[#52a8ec] focus:ring-2 focus:ring-[#52a8ec]/25"
            />
          </label>
          <button
            type="button"
            className="h-12 w-full rounded-[5px] bg-[#0205d3] text-base font-bold text-white"
          >
            Confirm
          </button>
        </form>
      </section>
    </main>
  );
}

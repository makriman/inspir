import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-white px-8 py-24 text-[#091747]">
      <section className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-5xl font-black">Oops! 404 error</h1>
        <p className="max-w-2xl text-lg leading-8 text-[#091747]/80">
          The page you&apos;re looking for does not exist.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex h-12 items-center rounded-[6px] bg-[#0205d3] px-6 font-bold text-white"
        >
          Go home
        </Link>
      </section>
    </main>
  );
}

"use client";

import { FormEvent, useState } from "react";

export function AdminTopicForm() {
  const [status, setStatus] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    setStatus("Saving...");
    const response = await fetch("/api/admin/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setStatus(response.ok ? "Module saved." : "Could not save module.");
    if (response.ok) event.currentTarget.reset();
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5">
      {[
        ["name", "Name"],
        ["subText", "Subtitle"],
        ["inputboxText", "Composer placeholder"],
      ].map(([name, label]) => (
        <label key={name} className="block text-sm font-black">
          {label}
          <input
            name={name}
            required
            className="mt-2 h-12 w-full rounded-[7px] border border-white/20 bg-black px-3 text-white outline-none focus:border-white"
          />
        </label>
      ))}
      <label className="block text-sm font-black">
        Description
        <textarea
          name="description"
          required
          rows={5}
          className="mt-2 w-full rounded-[7px] border border-white/20 bg-black px-3 py-3 text-white outline-none focus:border-white"
        />
      </label>
      <label className="block text-sm font-black">
        System prompt
        <textarea
          name="systemPrompt"
          required
          rows={8}
          className="mt-2 w-full rounded-[7px] border border-white/20 bg-black px-3 py-3 text-white outline-none focus:border-white"
        />
      </label>
      <button type="submit" className="h-12 rounded-[7px] bg-[#0500d8] px-6 font-black text-white">
        Save module
      </button>
      {status ? <p className="font-bold text-white/75">{status}</p> : null}
    </form>
  );
}

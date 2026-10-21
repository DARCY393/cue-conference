"use client";

import { FormEvent, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { isValidEmail } from "@/lib/validate";

export function ContactForm({ roomName, roomSlug }: { roomName?: string; roomSlug?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — real guests never see/fill this
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !isValidEmail(email) || !message.trim()) {
      setError("Fill in your name, a valid email, and a message.");
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, website, roomName, roomSlug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to send — try again.");
      }
      setStatus("success");
      setName("");
      setEmail("");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to send — try again.");
    }
  }

  if (status === "success") {
    return <Alert tone="success">Thanks — we&apos;ll get back to you soon.</Alert>;
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-3" noValidate>
      {/* Honeypot: hidden from real guests, left for bots to fill. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-cue-stone-500">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="cue-input"
        />
      </label>
      <label className="block text-sm">
        <span className="text-cue-stone-500">Email</span>
        <input
          type="text"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="cue-input"
        />
      </label>
      <label className="block text-sm">
        <span className="text-cue-stone-500">Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={5000}
          rows={3}
          className="cue-input"
        />
      </label>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" variant="secondary" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}

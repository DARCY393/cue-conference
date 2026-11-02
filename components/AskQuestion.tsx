"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { isValidEmail } from "@/lib/validate";

const OPEN_EVENT = "cue:ask-question";
const MAX_CHARS = 2000;

/** Secondary-style button that opens the "Ask a question" dialog. `onDark` for the navy hero. */
export function AskQuestionButton({ onDark = false, className = "", testId = "ask-question" }: { onDark?: boolean; className?: string; testId?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className={buttonClasses(
        "secondary",
        `${onDark ? "!border-white/50 !text-white hover:!bg-white/10 hover:!border-white" : ""} ${className}`.trim()
      )}
    >
      <MessageCircle aria-hidden className="h-4 w-4" />
      Ask a question
    </button>
  );
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; "expired-callback"?: () => void; appearance?: string }) => string;
      reset: (id?: string) => void;
    };
  }
}

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById("cf-turnstile-js");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }
    const s = document.createElement("script");
    s.id = "cf-turnstile-js";
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile load failed"));
    document.head.appendChild(s);
  });
}

/** The dialog itself; mount once per room page. */
export function AskQuestionDialog({ roomName = "The Cue conference rooms", roomSlug }: { roomName?: string; roomSlug?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [formToken, setFormToken] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const tsBox = useRef<HTMLDivElement>(null);

  const openDialog = useCallback(() => {
    setOpen(true);
    setError(null);
    fetch("/api/v1/inquiries", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { formToken?: string; turnstileSiteKey?: string | null }) => {
        setFormToken(d.formToken ?? null);
        setSiteKey(d.turnstileSiteKey ?? null);
      })
      .catch(() => setFormToken(null));
  }, []);

  useEffect(() => {
    window.addEventListener(OPEN_EVENT, openDialog);
    return () => window.removeEventListener(OPEN_EVENT, openDialog);
  }, [openDialog]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstField.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open || !siteKey || !tsBox.current || status === "success") return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !tsBox.current || !window.turnstile) return;
        tsBox.current.innerHTML = "";
        window.turnstile.render(tsBox.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: (t) => setTurnstileToken(t),
          "expired-callback": () => setTurnstileToken(""),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, siteKey, status]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !isValidEmail(email.trim()) || !message.trim()) {
      setError("Please add your name, a valid email and your question.");
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/v1/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, preferredDate, message, roomSlug, website, formToken, turnstileToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Something went wrong — please try again.");
      setStatus("success");
      setMessage("");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-cue-navy-900/60 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        data-testid="ask-question-dialog"
        className="cue-card max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-b-none p-6 sm:rounded-b-[var(--radius-card)]"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="cue-eyebrow text-cue-copper-600">{roomName}</p>
            <h2 id="ask-title" className="mt-1 text-2xl">Ask a question</h2>
          </div>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-cue-stone-500 hover:text-cue-navy-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {status === "success" ? (
          <div className="space-y-4" data-testid="ask-question-success">
            <Alert tone="success">
              Thanks, {name.split(/\s+/)[0]} — we got your question. We&apos;ll reply by email, usually within a
              business day. A copy is on its way to {email}.
            </Alert>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3" noValidate>
            <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
              <label>
                Company website
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-cue-stone-500">Name</span>
                <input ref={firstField} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" required className="cue-input" />
              </label>
              <label className="block text-sm">
                <span className="text-cue-stone-500">Email</span>
                <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} required className="cue-input" />
              </label>
              <label className="block text-sm">
                <span className="text-cue-stone-500">Phone <span className="text-cue-stone-400">(optional)</span></span>
                <input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className="cue-input" />
              </label>
              <label className="block text-sm">
                <span className="text-cue-stone-500">Date you have in mind <span className="text-cue-stone-400">(optional)</span></span>
                <input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} className="cue-input" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-cue-stone-500">Room</span>
              <input value={roomName} readOnly className="cue-input bg-cue-stone-100 text-cue-stone-700" />
            </label>
            <label className="block text-sm">
              <span className="text-cue-stone-500">Your question</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MAX_CHARS} rows={5} required className="cue-input" />
              <span className="mt-1 block text-right text-xs text-cue-stone-400">{message.length}/{MAX_CHARS}</span>
            </label>
            <div ref={tsBox} />
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="accent" disabled={status === "submitting"} data-testid="ask-question-submit">
                {status === "submitting" ? "Sending…" : "Send question"}
              </Button>
              <span className="text-xs text-cue-stone-500">We reply by email, usually within a business day.</span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

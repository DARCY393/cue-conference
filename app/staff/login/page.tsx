"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/host";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Sign-in failed");
      }
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <p className="cue-eyebrow">Staff</p>
      <h1 className="mt-2 text-3xl">Sign in</h1>
      <p className="mt-1 text-sm text-cue-stone-500">Staff accounts only.</p>
      <form noValidate onSubmit={handleSubmit} className="cue-card mt-6 space-y-4 p-6">
        <label className="block text-sm">
          <span className="text-cue-stone-500">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="cue-input"
          />
        </label>
        <label className="block text-sm">
          <span className="text-cue-stone-500">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="cue-input"
          />
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" variant="accent" fullWidth disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

export default function StaffLoginPage() {
  return (
    <Suspense fallback={<p className="text-cue-stone-500">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}

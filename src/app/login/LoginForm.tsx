"use client";

import { useState, type FormEvent } from "react";
import { createBrowserSupabase } from "@/lib/db";

type Step = "email" | "code";

const inputClass =
  "mt-1 block min-h-12 w-full rounded-xl border border-border bg-card px-4 text-base text-card-foreground placeholder:text-muted-foreground";
const buttonClass =
  "mt-4 flex min-h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-on-primary transition-opacity duration-200 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Email OTP (6-digit code), not a magic link: on iOS a link opens in Safari,
 * which doesn't share cookies with the installed PWA. Signups are disabled.
 */
export function LoginForm({ emailHint }: { emailHint: string }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(emailHint);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await createBrowserSupabase().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: "error", text: error.message });
      return;
    }
    setStep("code");
    setMessage({ kind: "info", text: `Code sent to ${email.trim()}. It expires in a few minutes.` });
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await createBrowserSupabase().auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setBusy(false);
      setMessage({ kind: "error", text: error.message });
      return;
    }
    window.location.replace("/");
  }

  return (
    <div className="mt-8">
      {step === "email" ? (
        <form onSubmit={sendCode} noValidate={false}>
          <label htmlFor="email" className="text-sm font-semibold">
            Email
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
          <button type="submit" disabled={busy || !email} className={buttonClass}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <label htmlFor="code" className="text-sm font-semibold">
            6-digit code
          </label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            minLength={6}
            maxLength={10}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`${inputClass} tracking-[0.4em] text-center text-2xl font-semibold`}
          />
          <button type="submit" disabled={busy || code.length < 6} className={buttonClass}>
            {busy ? "Verifying…" : "Verify and sign in"}
          </button>
          <div className="mt-3 flex justify-between">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setMessage(null);
              }}
              className="min-h-11 cursor-pointer px-1 text-sm font-semibold text-link"
            >
              Change email
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendCode()}
              className="min-h-11 cursor-pointer px-1 text-sm font-semibold text-link disabled:opacity-60"
            >
              Resend code
            </button>
          </div>
        </form>
      )}
      <p
        role={message?.kind === "error" ? "alert" : "status"}
        aria-live="polite"
        className={`mt-4 min-h-6 text-sm ${message?.kind === "error" ? "text-danger" : "text-muted-foreground"}`}
      >
        {message?.text ?? ""}
      </p>
    </div>
  );
}

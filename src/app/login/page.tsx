import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";
import { ownerEmailHint } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in · Tech Feed" };
// Reads OWNER_EMAIL and Supabase env at request time, not build time.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return (
    <main className="pt-safe px-safe pb-safe mx-auto flex min-h-dvh max-w-sm flex-col justify-center">
      <h1 className="font-serif text-4xl font-bold tracking-tight">Tech Feed</h1>
      <p className="mt-2 text-muted-foreground">Sign in with a one-time code sent to your email.</p>
      {configured ? (
        <LoginForm emailHint={ownerEmailHint()} />
      ) : (
        <p role="alert" className="mt-8 rounded-xl border border-border bg-card p-4 text-sm">
          Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see docs/SETUP.md).
        </p>
      )}
    </main>
  );
}

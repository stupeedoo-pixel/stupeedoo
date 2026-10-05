"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { googleAction, loginAction, registerAction, type FormState } from "./actions";

export function AuthForm({ mode, googleEnabled, next }: { mode: "login" | "register"; googleEnabled: boolean; next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(mode === "login" ? loginAction : registerAction, undefined);
  return (
    <div className="space-y-5">
      {googleEnabled && (
        <>
          <form action={googleAction}>
            <Button variant="secondary" className="w-full" type="submit">
              <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
              </svg>
              Continue with Google
            </Button>
          </form>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <form action={action} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        {mode === "register" && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" placeholder="Ada Lovelace" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required minLength={mode === "register" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </div>
        {state?.error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{state.error}</p>}
        <Button type="submit" className="w-full" loading={pending}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="text-center text-sm text-zinc-400">
        {mode === "login" ? (
          <>No account? <Link className="text-accent hover:underline" href="/register">Create one</Link></>
        ) : (
          <>Already have an account? <Link className="text-accent hover:underline" href="/login">Sign in</Link></>
        )}
      </p>
    </div>
  );
}

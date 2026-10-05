"use server";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { createAccount, registerSchema } from "@/lib/accounts";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";

export type FormState = { error?: string } | undefined;

async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    await rateLimit(`login:${await ip()}`, 20, 15 * 60);
    await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      redirectTo: String(form.get("next") || "/dashboard"),
    });
  } catch (err) {
    if (err instanceof AuthError) return { error: "Wrong email or password." };
    if (err instanceof AppError) return { error: err.message };
    throw err; // NEXT_REDIRECT on success
  }
}

export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    name: form.get("name") || undefined,
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    await rateLimit(`register:${await ip()}`, 10, 15 * 60);
    await createAccount(parsed.data);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  await signIn("credentials", { email: parsed.data.email, password: parsed.data.password, redirectTo: "/upload" });
}

export async function googleAction() {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}

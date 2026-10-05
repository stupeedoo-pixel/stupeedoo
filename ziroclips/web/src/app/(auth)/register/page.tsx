import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await auth()) redirect("/dashboard");
  const closed = !env().ALLOW_REGISTRATION && (await db.user.count()) > 0;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-zinc-400">{closed ? "Registration is closed on this instance." : "Start turning long videos into shorts."}</p>
      {!closed && <AuthForm mode="register" googleEnabled={googleEnabled} />}
    </>
  );
}

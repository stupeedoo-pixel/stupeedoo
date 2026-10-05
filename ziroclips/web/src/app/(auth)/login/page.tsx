import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/lib/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await auth()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-zinc-400">Sign in to your clips.</p>
      <AuthForm mode="login" googleEnabled={googleEnabled} next={next?.startsWith("/") ? next : undefined} />
    </>
  );
}

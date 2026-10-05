import { redirect } from "next/navigation";
import { currentUser } from "@/lib/api";
import { AppNav } from "@/components/app/nav";

/** Authenticated shell. Every page under (app) requires a signed-in user. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-dvh lg:pl-60">
      <AppNav user={{ email: user.email, name: user.name, plan: user.plan, isAdmin: user.role === "ADMIN" }} />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-20 sm:px-6 lg:pt-8">{children}</main>
    </div>
  );
}

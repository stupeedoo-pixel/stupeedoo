"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, LogOut, Menu, Plus, Settings, Shield, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/(auth)/actions";

type NavUser = { email: string; name: string | null; plan: string; isAdmin: boolean };

export function AppNav({ user }: { user: NavUser }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/settings", label: "Settings", icon: Settings },
    ...(user.isAdmin ? [{ href: "/admin", label: "Admin", icon: Shield }] : []),
  ];
  const body = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="px-2 pt-1"><Logo href="/dashboard" /></div>
      <Button asChild className="w-full" onClick={() => setOpen(false)}>
        <Link href="/upload"><Plus /> New video</Link>
      </Button>
      <nav className="flex flex-col gap-1">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-white",
              path.startsWith(it.href) && "bg-zinc-800/80 text-white",
            )}
          >
            <it.icon className="size-4" /> {it.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto rounded-lg border border-border bg-panel-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name || user.email.split("@")[0]}</p>
            <p className="truncate text-xs text-zinc-500">{user.email}</p>
          </div>
          <Badge tone={user.plan === "FREE" ? "default" : "accent"}>{user.plan}</Badge>
        </div>
        <form action={logoutAction} className="mt-3">
          <Button variant="ghost" size="sm" className="w-full justify-start px-2"><LogOut /> Sign out</Button>
        </form>
      </div>
    </div>
  );
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-panel lg:block">{body}</aside>
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/90 px-4 backdrop-blur lg:hidden">
        <Logo href="/dashboard" />
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></Button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-panel">
            <button className="absolute right-3 top-4 text-zinc-500" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
            {body}
          </aside>
        </div>
      )}
    </>
  );
}

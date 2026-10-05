import { requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { PLAN_LIMITS } from "@/lib/plans";
import { signedReadUrlOrNull } from "@/lib/storage";
import { monthlyUsage } from "@/lib/usage";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BrandKitForm } from "@/components/app/brand-kit-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const [usage, kit] = await Promise.all([
    monthlyUsage(user.id),
    db.brandKit.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } }),
  ]);
  const limits = PLAN_LIMITS[user.plan];
  const fin = (n: number) => Number.isFinite(n);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            Plan <Badge tone={user.plan === "FREE" ? "default" : "accent"}>{limits.label}</Badge>
            {user.role === "ADMIN" && <Badge tone="info">Admin</Badge>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-zinc-400">Minutes this month</span><span className="tabular-nums">{usage.minutesProcessed}{fin(limits.minutesPerMonth) && ` / ${limits.minutesPerMonth}`}</span></div>
              {fin(limits.minutesPerMonth) && <Progress value={(usage.minutesProcessed / limits.minutesPerMonth) * 100} />}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-zinc-400">Videos this month</span><span className="tabular-nums">{usage.videosProcessed}{fin(limits.videosPerMonth) && ` / ${limits.videosPerMonth}`}</span></div>
              {fin(limits.videosPerMonth) && <Progress value={(usage.videosProcessed / limits.videosPerMonth) * 100} />}
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Max {limits.maxVideoMinutes} min per video · exports: {limits.exportResolutions.join(", ")}.
            {/* ROADMAP (monetization): Stripe Checkout "Upgrade to Pro" + customer portal here. */}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand kit</CardTitle>
          <CardDescription>Your logo is burned into every export. The default caption style applies to newly generated clips.</CardDescription>
        </CardHeader>
        <CardContent>
          <BrandKitForm
            initial={{
              logoUrl: await signedReadUrlOrNull(kit.logoKey),
              logoPosition: kit.logoPosition,
              logoScalePct: kit.logoScalePct,
              primaryColor: kit.primaryColor,
              secondaryColor: kit.secondaryColor,
              fontFamily: kit.fontFamily,
              captionTemplate: ((kit.captionStyle as { template?: string } | null)?.template) ?? "bold-modern",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

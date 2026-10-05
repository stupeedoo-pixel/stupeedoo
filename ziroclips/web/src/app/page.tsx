import Link from "next/link";
import { ArrowRight, Captions, Crop, Gauge, Scissors, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { BRAND } from "@/lib/brand";
import { auth } from "@/lib/auth";

const features = [
  { icon: Sparkles, title: "AI highlight detection", body: "Claude reads the full transcript and picks self-contained moments with strong hooks — never mid-sentence." },
  { icon: Crop, title: "Speaker-tracking reframe", body: "Faces stay centred as 16:9 becomes 9:16, with smooth camera moves and hard cuts on speaker changes." },
  { icon: Captions, title: "Animated captions", body: "Word-by-word highlighted captions in four templates. Edit words, fonts, colours and position live." },
  { icon: Gauge, title: "Virality Score", body: "Every clip gets a 0–100 score from hook strength, emotion, pacing, completeness and energy." },
  { icon: Scissors, title: "Browser editor", body: "Trim, split, merge, reorder, add text, emoji and B-roll placeholders. Preview is instant." },
  { icon: Upload, title: "1080p & 4K export", body: "Burned-in captions, brand logo and loudness-normalised audio — ready to post." },
];

export default async function Landing() {
  const session = await auth();
  return (
    <div className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-lime-400/10 blur-3xl" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          {session ? (
            <Button asChild>
              <Link href="/dashboard">Open app <ArrowRight /></Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild><Link href="/login">Sign in</Link></Button>
              <Button asChild><Link href="/register">Get started</Link></Button>
            </>
          )}
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-6">
        <section className="py-20 text-center sm:py-28">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1 text-xs text-zinc-400">
            <span className="size-1.5 rounded-full bg-accent" /> Long video in · viral shorts out
          </p>
          <h1 className="mx-auto max-w-3xl font-display text-4xl font-black tracking-tight sm:text-6xl">
            {BRAND.tagline.split("—")[0]}
            <span className="text-accent">— automatically.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">{BRAND.description}</p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link href={session ? "/upload" : "/register"}>Clip your first video <ArrowRight /></Link>
            </Button>
            <Button size="lg" variant="secondary" asChild><Link href="#features">How it works</Link></Button>
          </div>
        </section>

        <section id="features" className="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-panel/80 p-6 backdrop-blur">
              <f.icon className="mb-4 size-5 text-accent" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="relative border-t border-border py-8 text-center text-xs text-zinc-500">
        © {new Date().getFullYear()} {BRAND.name}. Only process content you own or have rights to.
      </footer>
    </div>
  );
}

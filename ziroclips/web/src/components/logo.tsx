import Link from "next/link";
import { BRAND } from "@/lib/brand";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
          <path d="M7 3h10l-6 8h6L7 21l3-8H5z" />
        </svg>
      </span>
      {BRAND.name}
    </Link>
  );
}

"use client";
import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/client";
import { FONT_CHOICES, TEMPLATES } from "@/lib/captions";

type Kit = {
  logoUrl: string | null;
  logoPosition: string;
  logoScalePct: number;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  captionTemplate: string;
};

export function BrandKitForm({ initial }: { initial: Kit }) {
  const [kit, setKit] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/brand-kit/logo", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Upload failed");
      setKit((k) => ({ ...k, logoUrl: data.logoUrl }));
      toast.success("Logo uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true);
    try {
      // Brand colours/font flow into the default caption style for new clips.
      await api("/api/brand-kit", {
        method: "PUT",
        json: {
          logoPosition: kit.logoPosition,
          logoScalePct: kit.logoScalePct,
          primaryColor: kit.primaryColor,
          secondaryColor: kit.secondaryColor,
          fontFamily: kit.fontFamily,
          captionStyle: { template: kit.captionTemplate, highlightColor: kit.primaryColor.toUpperCase(), textColor: kit.secondaryColor.toUpperCase(), fontFamily: kit.fontFamily },
          ...extra,
        },
      });
      toast.success("Brand kit saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="grid size-20 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-[repeating-conic-gradient(#18181b_0%_25%,#111113_0%_50%)] bg-[length:12px_12px]">
          {kit.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={kit.logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <ImagePlus className="size-6 text-zinc-600" />
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>Upload logo</Button>
          {kit.logoUrl && (
            <Button variant="ghost" onClick={async () => { await save({ removeLogo: true }); setKit((k) => ({ ...k, logoUrl: null })); }}><Trash2 /> Remove</Button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Logo position</Label>
          <Select value={kit.logoPosition} onChange={(e) => setKit({ ...kit, logoPosition: e.target.value })}>
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Logo size · {Math.round(kit.logoScalePct * 100)}% width</Label>
          <Slider min={5} max={40} step={1} value={[kit.logoScalePct * 100]} onValueChange={([v]) => setKit({ ...kit, logoScalePct: v / 100 })} />
        </div>
        <div className="space-y-1.5">
          <Label>Default caption template</Label>
          <Select value={kit.captionTemplate} onChange={(e) => setKit({ ...kit, captionTemplate: e.target.value })}>
            {Object.entries(TEMPLATES).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Brand font</Label>
          <Select value={kit.fontFamily} onChange={(e) => setKit({ ...kit, fontFamily: e.target.value })}>
            {FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Highlight colour</Label>
          <input type="color" value={kit.primaryColor} onChange={(e) => setKit({ ...kit, primaryColor: e.target.value })} className="h-9 w-16 cursor-pointer bg-transparent" />
        </div>
        <div className="space-y-1.5">
          <Label>Caption text colour</Label>
          <input type="color" value={kit.secondaryColor} onChange={(e) => setKit({ ...kit, secondaryColor: e.target.value })} className="h-9 w-16 cursor-pointer bg-transparent" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button loading={saving} onClick={() => save()}>Save brand kit</Button>
      </div>
    </div>
  );
}

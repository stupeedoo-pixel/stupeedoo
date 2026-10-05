import { UploadForm } from "@/components/app/upload-form";
import { env } from "@/lib/env";

export const metadata = { title: "New video" };

export default function UploadPage() {
  const e = env();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">New video</h1>
        <p className="text-sm text-zinc-400">Upload a long-form video or import from YouTube. We&apos;ll find the best clips.</p>
      </div>
      <UploadForm youtubeEnabled={e.ENABLE_YOUTUBE} maxBytes={e.MAX_UPLOAD_BYTES} maxMinutes={e.MAX_VIDEO_MINUTES} />
    </div>
  );
}

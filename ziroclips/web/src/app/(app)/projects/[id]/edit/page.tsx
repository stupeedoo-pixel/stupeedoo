import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { PLAN_LIMITS } from "@/lib/plans";
import { clipDTO } from "@/lib/serializers";
import { signedReadUrlOrNull } from "@/lib/storage";
import { Editor } from "@/components/editor/editor";

export const metadata = { title: "Editor" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const project = await db.project.findFirst({ where: { id, userId: user.id }, include: { clips: { orderBy: { position: "asc" } } } });
  if (!project) notFound();
  if (project.status !== "READY") redirect(`/projects/${id}`);
  const brand = await db.brandKit.findUnique({ where: { userId: user.id } });

  return (
    <Suspense>
      <Editor
        projectId={project.id}
        projectTitle={project.title}
        initialClips={await Promise.all(project.clips.map(clipDTO))}
        source={{
          proxyUrl: await signedReadUrlOrNull(project.proxyKey),
          width: project.width ?? 1920,
          height: project.height ?? 1080,
          duration: project.durationSec ?? 0,
        }}
        brand={{
          logoUrl: await signedReadUrlOrNull(brand?.logoKey),
          logoPosition: brand?.logoPosition ?? "top-right",
          logoScalePct: brand?.logoScalePct ?? 0.14,
        }}
        allow4k={PLAN_LIMITS[user.plan].exportResolutions.includes("4k")}
      />
    </Suspense>
  );
}

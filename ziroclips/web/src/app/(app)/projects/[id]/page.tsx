import { notFound } from "next/navigation";
import { requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { activeJobs } from "@/lib/jobs";
import { clipDTO, projectDTO } from "@/lib/serializers";
import { ProjectView } from "@/components/app/project-view";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const project = await db.project.findFirst({
    where: { id, userId: user.id },
    include: { clips: { orderBy: { position: "asc" } }, _count: { select: { clips: true } } },
  });
  if (!project) notFound();
  return (
    <ProjectView
      initial={{ project: await projectDTO(project), clips: await Promise.all(project.clips.map(clipDTO)), jobs: await activeJobs(project.id) }}
    />
  );
}

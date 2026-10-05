import { route, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { clipDTO, ownedProject } from "@/lib/serializers";

/** GET /api/projects/:id/clips?sort=position|score */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await ownedProject(user.id, params.id);
  const sort = req.nextUrl.searchParams.get("sort") === "score" ? { viralityScore: "desc" as const } : { position: "asc" as const };
  const clips = await db.clip.findMany({ where: { projectId: params.id }, orderBy: sort });
  return { clips: await Promise.all(clips.map(clipDTO)) };
});

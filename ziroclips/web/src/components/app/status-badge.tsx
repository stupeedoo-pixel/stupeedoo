import { Badge } from "@/components/ui/badge";
import type { ProjectDTO } from "@/lib/types";

const map: Record<ProjectDTO["status"], { tone: "default" | "accent" | "warn" | "danger" | "info"; label: string }> = {
  UPLOADING: { tone: "info", label: "Uploading" },
  QUEUED: { tone: "info", label: "Queued" },
  PROCESSING: { tone: "warn", label: "Processing" },
  READY: { tone: "accent", label: "Ready" },
  FAILED: { tone: "danger", label: "Failed" },
};

export function StatusBadge({ status }: { status: ProjectDTO["status"] }) {
  const s = map[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

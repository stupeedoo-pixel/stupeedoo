"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { api } from "@/lib/client";

type Row = { id: string; email: string; name: string | null; role: string; plan: string; createdAt: string; projects: number; minutes: number; clips: number; exports: number };

export function AdminUsers({ users, currentUserId }: { users: Row[]; currentUserId: string }) {
  const [rows, setRows] = useState(users);
  async function update(id: string, patch: { plan?: string; role?: string }) {
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", json: patch });
      setRows((r) => r.map((u) => (u.id === id ? { ...u, ...patch } : u)));
      toast.success("Updated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="p-3">User</th><th className="p-3">Plan</th><th className="p-3">Role</th>
            <th className="p-3 text-right">Projects</th><th className="p-3 text-right">Min (mo)</th><th className="p-3 text-right">Clips (mo)</th><th className="p-3 text-right">Exports (mo)</th><th className="p-3">Joined</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-b border-border/60 last:border-0">
              <td className="p-3">
                <p className="font-medium">{u.name ?? "—"}</p>
                <p className="text-xs text-zinc-500">{u.email}</p>
              </td>
              <td className="p-3">
                <Select value={u.plan} onChange={(e) => update(u.id, { plan: e.target.value })} className="h-8 w-32">
                  <option>FREE</option><option>PRO</option><option>UNLIMITED</option>
                </Select>
              </td>
              <td className="p-3">
                {u.id === currentUserId ? <Badge tone="info">{u.role}</Badge> : (
                  <Select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })} className="h-8 w-28">
                    <option>USER</option><option>ADMIN</option>
                  </Select>
                )}
              </td>
              <td className="p-3 text-right tabular-nums">{u.projects}</td>
              <td className="p-3 text-right tabular-nums">{u.minutes}</td>
              <td className="p-3 text-right tabular-nums">{u.clips}</td>
              <td className="p-3 text-right tabular-nums">{u.exports}</td>
              <td className="p-3 text-xs text-zinc-500">{new Date(u.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

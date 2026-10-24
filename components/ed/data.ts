"use client";

// 화면들이 같이 쓰는 데이터 — 업무 · 수정 요청 · 고르는 목록(사람 · 카테고리 · 목표).
// 쓰기는 기존 API 그대로(`/api/tasks`, `/api/tasks/:id`) — 새 규칙 없음.
import { useCallback, useEffect, useState } from "react";
import type { EdTask } from "@/lib/ed/core";
import { api, emitChanged, useOnChanged } from "./ui";

export interface Person { id: number; name: string }
export interface Area { id: number; name: string }
export interface GoalLite { id: number; title: string; periodType: string; parentId: number | null }
export interface Meta { me: Person; people: Person[]; areas: Area[]; goals: GoalLite[] }
export interface Revision { id: number; taskId: number; requesterId: number; requesterName: string; memo: string; createdAt: string }

let metaCache: Promise<Meta> | null = null;
export function useMeta(): Meta | null {
  const [m, setM] = useState<Meta | null>(null);
  useEffect(() => {
    metaCache ??= api<Meta>("/api/ed/meta").catch((e) => { metaCache = null; throw e; });
    metaCache.then(setM).catch(() => {});
  }, []);
  return m;
}

/** 모든 업무(하위 포함) + 열린 수정 요청. `ed:changed` 가 오면 다시 읽는다 */
export function useTasks(query = ""): { tasks: EdTask[] | null; revisions: Revision[]; reload: () => Promise<void>; setTasks: React.Dispatch<React.SetStateAction<EdTask[] | null>> } {
  const [tasks, setTasks] = useState<EdTask[] | null>(null);
  const [revisions, setRev] = useState<Revision[]>([]);
  const reload = useCallback(async () => {
    const [t, r] = await Promise.all([
      api<{ tasks: EdTask[] }>(`/api/tasks${query}`),
      api<{ revisions: Revision[] }>("/api/revisions").catch(() => ({ revisions: [] })),
    ]);
    setTasks(t.tasks); setRev(r.revisions);
  }, [query]);
  useEffect(() => { void reload(); }, [reload]);
  useOnChanged(() => { void reload(); });
  return { tasks, revisions, reload, setTasks };
}

export async function patchTask(id: number, body: Record<string, unknown>, quiet = false): Promise<void> {
  await api(`/api/tasks/${id}`, { method: "PATCH", body });
  if (!quiet) emitChanged();
}
export async function createTask(body: Record<string, unknown>): Promise<{ id: number }> {
  const d = await api<{ id?: number; task?: { id: number } }>("/api/tasks", { method: "POST", body });
  emitChanged();
  return { id: d.id ?? d.task?.id ?? 0 };
}
export async function deleteTask(id: number): Promise<void> {
  await api(`/api/tasks/${id}`, { method: "PATCH", body: { isActive: false } });
  emitChanged();
}

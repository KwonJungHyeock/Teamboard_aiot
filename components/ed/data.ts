"use client";

// 화면들이 같이 쓰는 데이터 — 업무 · 수정 요청 · 고르는 목록(사람 · 카테고리 · 목표).
// 쓰기는 기존 API 그대로(`/api/tasks`, `/api/tasks/:id`) — 새 규칙 없음.
import { useCallback, useEffect, useState } from "react";
import { catColor, todayKst, type EdTask } from "@/lib/ed/core";
import type { ComboOpt } from "./Combo";
import { api, emitChanged, useOnChanged } from "./ui";

export interface Person { id: number; name: string }
export interface Area { id: number; name: string }
export interface GoalLite { id: number; title: string; periodType: string; parentId: number | null; scope?: string; ownerId?: number | null }
export interface Meta { me: Person & { lead?: boolean }; people: Person[]; areas: Area[]; goals: GoalLite[] }
export interface Revision { id: number; taskId: number; requesterId: number; requesterName: string; memo: string; createdAt: string }

let metaCache: Promise<Meta> | null = null;
const metaSubs = new Set<(m: Meta) => void>();
const loadMeta = () => (metaCache ??= api<Meta>("/api/ed/meta").catch((e) => { metaCache = null; throw e; }));
export function useMeta(): Meta | null {
  const [m, setM] = useState<Meta | null>(null);
  useEffect(() => {
    metaSubs.add(setM);
    loadMeta().then(setM).catch(() => {});
    return () => { metaSubs.delete(setM); };
  }, []);
  return m;
}
/** 카테고리 · 목표를 만들거나 지운 뒤 — 고르는 목록을 쓰는 모든 화면에 새 목록을 돌린다 */
export async function refreshMeta(): Promise<Meta> {
  metaCache = null;
  const m = await loadMeta();
  metaSubs.forEach((f) => f(m));
  return m;
}

// ── 카테고리 · 목표 — 고르거나 적기(Combo)가 같이 쓴다. 등록 창 · 드로어가 같은 규칙 ──
/** 카테고리 고르기 목록. 「기타」는 지울 수 없다(서버도 막는다) */
export const areaOpts = (m: Meta | null): ComboOpt[] =>
  (m?.areas ?? []).map((a) => ({ id: a.id, label: a.name, dot: catColor(a.name), removable: a.name !== "기타" }));
/** 새 카테고리 — 만든 id */
export async function makeArea(name: string): Promise<number> {
  const { area } = await api<{ area: { id: number } }>("/api/ed/areas", { method: "POST", body: { name } });
  await refreshMeta(); emitChanged();
  return area.id;
}
/** 카테고리 지우기 — 물어보고, 그 업무는 기타로. 알림 문구를 돌려준다(취소면 null) */
export async function dropArea(a: { id: number; label: string }): Promise<string | null> {
  if (!window.confirm(`「${a.label}」 카테고리를 지울까요?\n이 카테고리의 업무는 「기타」로 옮겨집니다.`)) return null;
  const r = await api<{ moved: number }>(`/api/ed/areas?id=${a.id}`, { method: "DELETE" });
  await refreshMeta(); emitChanged();
  return r.moved ? `지웠습니다 · 업무 ${r.moved}건 → 기타` : "지웠습니다";
}
/** 목표 고르기 목록 — 개인 업무면 내 개인 목표만(서버 규칙과 같다). 연간 목표는 업무에 직접 안 붙인다 */
export function goalOpts(m: Meta | null, personal: boolean): ComboOpt[] {
  if (!m) return [];
  const canDrop = (g: GoalLite) => (g.scope === "personal" ? g.ownerId === m.me.id : !!m.me.lead);
  return m.goals.filter((g) => g.periodType !== "year" && (!personal || g.scope === "personal"))
    .map((g) => ({ id: g.id, label: g.title, removable: canDrop(g) }));
}
/** 목표를 새로 만들 수 있는가 — 개인 목표는 누구나, 팀 목표는 팀장 */
export const canMakeGoal = (m: Meta | null, personal: boolean) => personal || !!m?.me.lead;
/** 새 목표 — 이번 달 월 목표로 만든다(기간 · 상위는 목표 화면에서 정리) */
export async function makeGoal(title: string, personal: boolean): Promise<number> {
  const { goal } = await api<{ goal: { id: number } }>("/api/goals", { method: "POST", body: { title, scope: personal ? "personal" : "team", periodType: "month", periodStart: `${todayKst().slice(0, 7)}-01` } });
  await refreshMeta(); emitChanged();
  return goal.id;
}
/** 목표 지우기(보관) — 물어보고. 지웠으면 true */
export async function dropGoal(g: { id: number; label: string }): Promise<boolean> {
  if (!window.confirm(`「${g.label}」 목표를 지울까요?\n붙어 있던 업무는 그대로 남고, 목표 화면 보관함에서 되살릴 수 있습니다.`)) return false;
  await api(`/api/goals/${g.id}`, { method: "PUT", body: { isActive: false } });
  await refreshMeta(); emitChanged();
  return true;
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

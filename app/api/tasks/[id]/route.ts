// 업무 수정 (Phase 5) — 속성 수정 · 상태 전이 · 인박스 승인/기각 · 목표 연결(다중, 선택).
// 삭제는 소프트만: isActive=false. 하드 삭제 핸들러는 의도적으로 없다 (검수 포인트 4).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { recomputeGoalChain } from "@/lib/goals";
import { jsonError } from "@/lib/api";
import { decisionsForTask } from "@/lib/decisions";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["proposed", "todo", "doing", "review", "done", "dropped"] as const;
const PRIORITIES = ["high", "mid", "low"] as const;

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession(); // Task는 member 전권 (SPEC 6장)
    const taskId = Number(params.id);
    const payload = await request.json();

    const task = await queryOne<{
      id: number; title: string; status: string; assignee_id: number | null;
      start_date: string | null; due_date: string | null; progress: number; blocked: boolean;
    }>(
      "SELECT id, title, status, assignee_id, start_date::text, due_date::text, progress, blocked FROM task WHERE id = $1 AND is_active = true",
      [taskId]
    );
    if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });

    // 소프트 삭제
    if (payload.isActive === false) {
      await query("UPDATE task SET is_active = false, updated_at = now() WHERE id = $1", [taskId]);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 업무 삭제 — "${task.title}"`,
        level: "warn",
        taskId,
      });
      return NextResponse.json({ ok: true });
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (typeof payload.title === "string" && payload.title.trim()) {
      set("title", payload.title.trim().slice(0, 200));
    }
    if (typeof payload.description === "string") set("description", payload.description.slice(0, 4000));
    if ((PRIORITIES as readonly string[]).includes(payload.priority)) set("priority", payload.priority);
    if (payload.projectId !== undefined) set("project_id", payload.projectId ? Number(payload.projectId) : null);
    // 활동 로그(파트 5) — 의미 있는 변경(담당·진행률·목표·상태)만 기록.
    const extraLogs: string[] = [];
    if (payload.assigneeId !== undefined) {
      const newAssignee = payload.assigneeId ? Number(payload.assigneeId) : null;
      set("assignee_id", newAssignee);
      if (newAssignee !== task.assignee_id) {
        const ids = [task.assignee_id, newAssignee].filter((x): x is number => !!x);
        const names = ids.length
          ? await query<{ id: number; display_name: string }>(
              "SELECT id, display_name FROM actor WHERE id = ANY($1)", [ids]
            )
          : [];
        const nm = (id: number | null) => (id ? names.find((n) => n.id === id)?.display_name ?? `#${id}` : "미지정");
        extraLogs.push(`${session.name}이(가) 담당 변경 (${nm(task.assignee_id)} → ${nm(newAssignee)}) — "${task.title}"`);
        // 배정 알림 (MD-P-2026-007 §A "배정") — 기존 assign 타입을 그대로 쓴다.
        // 내가 나에게 배정한 경우는 createNotification이 걸러낸다.
        if (newAssignee) {
          await notify({
            userId: newAssignee, type: "assign", refType: "task", refId: taskId,
            snippet: `업무 배정 · ${task.title}`, actorId: session.id,
          });
        }
      }
    }
    const isDate = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    // 병합값 기준으로 시작일<=마감일 검증 (한쪽만 수정해도 정합성 유지)
    const nextStart =
      payload.startDate !== undefined ? (isDate(payload.startDate) ? payload.startDate : null) : task.start_date;
    const nextDue =
      payload.dueDate !== undefined ? (isDate(payload.dueDate) ? payload.dueDate : null) : task.due_date;
    if (nextStart && nextDue && nextStart > nextDue) {
      return NextResponse.json({ error: "시작일이 마감일보다 늦을 수 없습니다." }, { status: 400 });
    }
    if (payload.startDate !== undefined) set("start_date", isDate(payload.startDate) ? payload.startDate : null);
    if (payload.dueDate !== undefined) set("due_date", isDate(payload.dueDate) ? payload.dueDate : null);
    if (payload.areaId !== undefined && payload.areaId) set("area_id", Number(payload.areaId));
    if (["team", "personal", "routine"].includes(payload.workType)) set("work_type", payload.workType);

    let statusLog = "";
    if (payload.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(payload.status)) {
        return NextResponse.json({ error: "상태 값이 올바르지 않습니다." }, { status: 400 });
      }
      // 인박스 승인·기각(proposed의 상태 전이)은 담당자 본인 또는 lead만 — drafts 승인 규칙과 동일
      if (task.status === "proposed" && payload.status !== "proposed") {
        const canJudge = session.role === "lead" || task.assignee_id === session.id;
        if (!canJudge) {
          return NextResponse.json(
            { error: "제안 업무의 승인·기각은 담당자 본인 또는 팀장만 할 수 있습니다." },
            { status: 403 }
          );
        }
      }
      // 중단 전환은 사유 필수 — 진척률 분모에서 빠지므로 우회 방지 (SPEC v1.1 예정)
      let dropReason = "";
      if (payload.status === "dropped" && task.status !== "proposed") {
        dropReason = String(payload.dropReason ?? "").trim().slice(0, 500);
        if (!dropReason) {
          return NextResponse.json({ error: "중단 사유를 입력하세요." }, { status: 400 });
        }
        set("drop_reason", dropReason);
        set("dropped_at", new Date().toISOString());
      } else if (payload.status !== "dropped") {
        set("drop_reason", null);
        set("dropped_at", null);
      }
      set("status", payload.status);
      // 완료 시각은 상태 전이에서만 기록/해제
      if (payload.status === "done") set("completed_at", new Date().toISOString());
      else set("completed_at", null);
      if (task.status === "proposed" && payload.status === "todo") {
        statusLog = `${session.name}이(가) 에이전트 제안 업무 승인 — "${task.title}"`;
      } else if (task.status === "proposed" && payload.status === "dropped") {
        statusLog = `${session.name}이(가) 에이전트 제안 업무 기각 — "${task.title}"`;
      } else if (payload.status === "dropped") {
        statusLog = `${session.name}이(가) 업무 중단 — "${task.title}" (사유: ${dropReason})`;
      } else {
        statusLog = `${session.name}이(가) 업무 상태 변경 (${task.status} → ${payload.status}) — "${task.title}"`;
      }
    }

    // 진행률(파트 4) — 수동 0~100. 완료 전환 시 100으로 정합. 중복 set 방지 위해 단일 처리.
    let nextProgress: number | undefined;
    if (payload.progress !== undefined) {
      const p = Math.round(Number(payload.progress));
      if (!Number.isNaN(p)) nextProgress = Math.max(0, Math.min(100, p));
    }
    if (payload.status === "done") nextProgress = 100;
    if (nextProgress !== undefined && nextProgress !== task.progress) {
      set("progress", nextProgress);
      extraLogs.push(`${session.name}이(가) 진행률 변경 (${task.progress}% → ${nextProgress}%) — "${task.title}"`);
    }

    // 막힘(blocked) 플래그 — 상태와 별개. 표시 시 사유 필수, 해제 시 상태 유지.
    if (payload.blocked !== undefined) {
      const wantBlocked = payload.blocked === true;
      if (wantBlocked) {
        const reason = String(payload.blockedReason ?? "").trim().slice(0, 500);
        if (!reason) {
          return NextResponse.json({ error: "막힘 사유를 입력하세요." }, { status: 400 });
        }
        set("blocked", true);
        set("blocked_reason", reason);
        // 새로 막힘 표시할 때만 시각 갱신(이미 막힌 상태의 사유 수정은 시각 유지)
        if (!task.blocked) set("blocked_since", new Date().toISOString());
        set("blocked_by", payload.blockedBy ? Number(payload.blockedBy) : null);
        extraLogs.push(
          task.blocked
            ? `${session.name}이(가) 막힘 사유 수정 — "${task.title}" (${reason})`
            : `${session.name}이(가) 막힘 표시 — "${task.title}" (사유: ${reason})`
        );
      } else if (task.blocked) {
        set("blocked", false);
        set("blocked_reason", null);
        set("blocked_since", null);
        set("blocked_by", null);
        extraLogs.push(`${session.name}이(가) 막힘 해제 — "${task.title}"`);
      }
    }

    // 100% ⇒ 완료 자동 (모순 "100%인데 대기" 방지). 명시적 상태 변경/이미 완료·중단·제안은 제외.
    let autoCompleted = false;
    if (
      payload.status === undefined &&
      nextProgress === 100 &&
      task.status !== "done" && task.status !== "dropped" && task.status !== "proposed"
    ) {
      set("status", "done");
      set("completed_at", new Date().toISOString());
      set("drop_reason", null);
      set("dropped_at", null);
      autoCompleted = true;
      statusLog = `${session.name}이(가) 진행률 100% 도달로 업무 완료 — "${task.title}"`;
    }

    if (sets.length > 0) {
      values.push(taskId);
      await query(`UPDATE task SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
    }

    // 진척 재계산 대상 목표 수집 (파트 B) — 변경 전 연결 목표부터.
    const affectedGoals = new Set<number>();
    const statusChanged = (typeof payload.status === "string" && payload.status !== task.status) || autoCompleted;

    // 목표 연결 교체 — 다중 선택, 선택 사항. 월 목표만 허용 (SPEC 2.2)
    if (Array.isArray(payload.goalIds)) {
      const priorLinks = await query<{ goal_id: number }>(
        "SELECT goal_id FROM goal_task WHERE task_id = $1",
        [taskId]
      );
      priorLinks.forEach((l) => affectedGoals.add(l.goal_id));
      const priorSet = new Set(priorLinks.map((l) => l.goal_id));
      const goalIds = payload.goalIds.map(Number).filter((n: number) => Number.isInteger(n));
      await query("DELETE FROM goal_task WHERE task_id = $1", [taskId]);
      for (const goalId of goalIds) {
        await query(
          `INSERT INTO goal_task (goal_id, task_id)
           SELECT $1, $2 WHERE EXISTS (
             SELECT 1 FROM goal WHERE id = $1 AND is_active = true AND period_type = 'month'
           )
           ON CONFLICT DO NOTHING`,
          [goalId, taskId]
        );
      }
      const changed = goalIds.length !== priorSet.size || goalIds.some((g: number) => !priorSet.has(g));
      if (changed) extraLogs.push(`${session.name}이(가) 연결 목표 변경 — "${task.title}"`);
    }

    // 현재(변경 후) 연결 목표 — 상태 변경 시에도 재계산 대상
    if (statusChanged || Array.isArray(payload.goalIds)) {
      const nowLinks = await query<{ goal_id: number }>(
        "SELECT goal_id FROM goal_task WHERE task_id = $1",
        [taskId]
      );
      nowLinks.forEach((l) => affectedGoals.add(l.goal_id));
    }
    // MD-P-2026-005 §E — 업무는 소속 프로젝트를 통해서도 목표에 기여한다.
    // 진척·기간·상태가 바뀌면 프로젝트 롤업이 달라지므로 연결 목표도 재계산 대상에 넣는다.
    const rollupChanged = statusChanged
      || payload.progress !== undefined
      || payload.startDate !== undefined
      || payload.dueDate !== undefined
      || payload.projectId !== undefined;
    if (rollupChanged) {
      const viaProject = await query<{ goal_id: number }>(
        `SELECT p.goal_id FROM task t JOIN project p ON p.id = t.project_id
         WHERE t.id = $1 AND p.goal_id IS NOT NULL`,
        [taskId]
      );
      viaProject.forEach((r) => affectedGoals.add(r.goal_id));
    }
    // 연결 체인(월→분기→연간) 즉시 재계산 — 홈·목표 화면에 바로 반영 (파트 B)
    for (const gid of Array.from(affectedGoals)) await recomputeGoalChain(gid);

    // 활동 타임라인(파트 5) — 의미 있는 변경만 기록: 상태·담당·진행률·목표연결.
    // (제목·설명 등 잡음성 필드는 제외. 코멘트는 코멘트 라우트가 기록.)
    for (const msg of extraLogs) {
      await logActivity({ userId: session.id, message: msg, taskId });
    }
    if (statusLog) {
      await logActivity({ userId: session.id, message: statusLog, taskId });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

// PATCH — PUT과 동일(부분 수정). 상세 패널 인라인 자동저장이 사용.
export async function PATCH(request: Request, ctx: { params: { id: string } }) {
  return PUT(request, ctx);
}

// GET — 상세 패널용 단일 업무 전체 정보 (+ 영역·프로젝트·담당 이름, 연결 목표, 활동 로그)
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    requireSession();
    const id = Number(params.id);
    const t = await queryOne<{
      id: number; title: string; description: string; status: string; priority: string;
      origin: string; work_type: string; area_id: number; area_name: string; area_color: string | null;
      project_id: number | null; project_name: string | null; color_key: string | null;
      assignee_id: number | null; assignee_name: string | null; created_by_name: string | null;
      start_date: string | null; due_date: string | null; drop_reason: string | null;
      progress: number; goal_ids: number[] | null;
      blocked: boolean; blocked_reason: string | null; blocked_since: string | null; blocked_by: number | null;
    }>(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.origin, t.work_type,
              t.area_id, ar.name AS area_name, ar.color_key AS area_color,
              t.project_id, p.name AS project_name, p.color_key,
              t.assignee_id, a.display_name AS assignee_name, c.display_name AS created_by_name,
              t.start_date::text, t.due_date::text, t.drop_reason, t.progress,
              array_agg(gt.goal_id) FILTER (WHERE gt.goal_id IS NOT NULL) AS goal_ids,
              t.blocked, t.blocked_reason, t.blocked_since::text, t.blocked_by
       FROM task t
       JOIN area ar ON ar.id = t.area_id
       LEFT JOIN project p ON p.id = t.project_id
       LEFT JOIN actor a ON a.id = t.assignee_id
       LEFT JOIN actor c ON c.id = t.created_by
       LEFT JOIN goal_task gt ON gt.task_id = t.id
       WHERE t.id = $1 AND t.is_active = true
       GROUP BY t.id, ar.name, ar.color_key, p.name, p.color_key, a.display_name, c.display_name`,
      [id]
    );
    if (!t) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });

    const activity = await query<{ id: number; message: string; level: string; created_at: string; user_name: string | null }>(
      `SELECT al.id, al.message, al.level, al.created_at::text, u.display_name AS user_name
       FROM activity_log al LEFT JOIN actor u ON u.id = al.user_id
       WHERE al.task_id = $1 ORDER BY al.created_at DESC LIMIT 30`,
      [id]
    );

    return NextResponse.json({
      task: {
        id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority,
        origin: t.origin, workType: t.work_type, areaId: t.area_id, areaName: t.area_name, areaColor: t.area_color,
        projectId: t.project_id, projectName: t.project_name, colorKey: t.color_key,
        assigneeId: t.assignee_id, assigneeName: t.assignee_name, createdByName: t.created_by_name,
        startDate: t.start_date, dueDate: t.due_date, dropReason: t.drop_reason,
        progress: t.progress ?? 0,
        goalIds: t.goal_ids ?? [],
        blocked: t.blocked ?? false,
        blockedReason: t.blocked_reason,
        blockedSince: t.blocked_since,
        blockedBy: t.blocked_by,
      },
      activity,
      // 양방향 링크 — 이 업무에 연결된 결정 (MD-P-2026-004 §E)
      decisions: await decisionsForTask(id),
    });
  } catch (error) {
    return jsonError(error);
  }
}

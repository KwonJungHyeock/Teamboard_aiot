// 업무 API (Phase 5) — GET: 목록(필터) + 인박스(proposed), POST: 생성.
// status='proposed'는 에이전트 제안 상태 — 홈·캘린더·타임라인 집계에서 제외되고
// /tasks 인박스에서만 노출된다 (CHANGE-GUIDE Phase 5-1).
import { NextResponse } from "next/server";
import { NEW_TASK_GOAL_SOURCE } from "@/lib/goal-inherit";
import { checkParent } from "@/lib/subtask";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { kstToday } from "@/lib/home";
import { visibleTaskSql, isVisibility } from "@/lib/visibility";
import { countableSql, doneSql, taskProgress } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["proposed", "todo", "doing", "review", "done", "dropped"] as const;
const PRIORITIES = ["high", "mid", "low"] as const;
const WORK_TYPES = ["team", "personal", "routine"] as const;

export interface TaskListRow {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  origin: string;
  projectId: number | null;
  projectName: string | null;
  colorKey: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  areaId: number;
  areaName: string;
  workType: string;
  startDate: string | null;
  dueDate: string | null;
  goalIds: number[];
  progress: number;
  createdByName: string | null;
  blocked: boolean;
  blockedReason: string | null;
  blockedBy: number | null;
  visibility: "team" | "private";
  /** §A3 계층 — 목록이 접기/펼치기를 그릴 재료 */
  parentTaskId: number | null;
  /** §C — "직접 정한 순서" 의 값 */
  sortOrder: number;
  childCount: number;
}

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    const area = url.searchParams.get("area");
    const project = url.searchParams.get("project");
    const assignee = url.searchParams.get("assignee");
    const status = url.searchParams.get("status");
    const due = url.searchParams.get("due"); // overdue | 7d | 30d | none
    const blocked = url.searchParams.get("blocked"); // "1" → 막힌 업무만

    // 필터 절은 **별칭을 바꿔 두 번** 쓴다 (MD-P-2026-028 §A3).
    //   하위 행은 필터·정렬의 대상이 아니다. 상위가 걸리면 따라 나오고,
    //   하위만 걸리면 상위를 살려서 보여준다 — 목표 트리의 재귀 CTE 와 같은 처리다.
    // 그래서 조건을 `t.` 로 적고, 필요할 때 `c.`(하위) · `p.`(상위) 로 갈아 끼운다.
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    /** 같은 조건을 다른 별칭으로. `t.` 로만 적은 절이라 치환이 안전하다. */
    const clauses = () => (where.length ? where.join(" AND ") : "true");
    const asAlias = (a: string) => clauses().replace(/\bt\./g, `${a}.`);

    // ① 업무 목록 — 남의 개인 업무는 목록에 오르지 않는다 (§A3).
    //    화면에서 거르지 않는다. 쿼리에서 빠진다.
    params.push(session.id);
    const viewerParam = `$${params.length}`;

    if (status && (STATUSES as readonly string[]).includes(status)) {
      add("t.status = ?", status);
    } else {
      // 기본 목록은 proposed 제외 — 인박스는 status=proposed로 명시 조회
      where.push("t.status <> 'proposed'");
    }
    // 영역은 **여러 개**를 받는다 — `?area=2,3` (MD-P-2026-027 §B2).
    // 사이드바에서 한 번에 하나만 고르던 것을 필터 칩 다중 선택으로 바꿨다.
    // 값 하나만 오는 예전 링크(`?area=2`)도 그대로 동작한다.
    if (area) {
      const ids = area.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length === 1) add("t.area_id = ?", ids[0]);
      else if (ids.length > 1) add("t.area_id = ANY(?::int[])", ids);
    }
    if (project) add("t.project_id = ?", Number(project));
    if (assignee) add("t.assignee_id = ?", Number(assignee));

    const today = kstToday();
    if (due === "overdue") {
      add("t.due_date < ?::date", today);
      where.push("t.status NOT IN ('done','dropped')");
    } else if (due === "7d" || due === "30d") {
      add("t.due_date >= ?::date", today);
      const end = new Date(`${today}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + (due === "7d" ? 7 : 30));
      add("t.due_date <= ?::date", end.toISOString().slice(0, 10));
    } else if (due === "none") {
      where.push("t.due_date IS NULL");
    }
    if (blocked === "1") where.push("t.blocked = true");
    // §C1 「내가 막는 것」 타일이 여는 목록 — 이 업무를 원인으로 **남이** 막혀 있는 것.
    // 028 §B2 역방향 차단을 목록 조건으로 쓰는 첫 자리다. 새 개념이 아니다.
    if (url.searchParams.get("blocking") === "1") {
      where.push(`EXISTS (SELECT 1 FROM task bk
                           WHERE bk.blocked_by = t.id AND bk.is_active = true AND bk.blocked = true
                             AND bk.assignee_id IS DISTINCT FROM t.assignee_id)`);
    }

    /**
     * §C2-정렬 — **정렬은 전부 서버에서 건다.**
     *
     * 전에는 서버가 기한순으로 300건을 자른 **뒤에** 클라이언트가 다시 정렬했다.
     * 그러면 "직접 정한 순서"의 1페이지 첫 행이 전체의 첫 행이 아니다 —
     * 300건을 넘는 순간 틀린 답을 낸다. 지금 56건이라 안 보였을 뿐이다.
     * §C4 가 이 목록을 4개 화면이 공유하는 컴포넌트로 만들라고 하므로,
     * 지금 구조를 그대로 옮기면 같은 결함이 4곳에 복제된다.
     *
     * `LIMIT` 은 **정렬 뒤에** 걸린다. 이게 이 수정의 전부이자 핵심이다.
     *
     * 값은 넷뿐이다(031 §C 회신 제1부 §3). `progress` 는 없앴다 —
     * `task.progress` 컬럼은 화면에 보이는 진척이 아니라서(하위를 가진 업무는
     * lib/progress.ts 가 계산한다) `ORDER BY t.progress` 로 줄을 세우면
     * 정렬 순서와 표시 퍼센트가 어긋난다. 피하려면 계산기를 SQL 로 한 벌 더
     * 만들어야 하고, 그건 030 에서 아홉을 하나로 합친 것을 다시 가르는 일이다.
     */
    const ORDER_BY = {
      // 지연 → 임박 → 여유 → 기한없음. 동률이면 우선순위, 그다음 최신 작성순.
      due: "t.due_date ASC NULLS LAST, "
        + "CASE t.priority WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END ASC, t.created_at DESC, t.id DESC",
      priority: "CASE t.priority WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END ASC, "
        + "t.due_date ASC NULLS LAST, t.created_at DESC, t.id DESC",
      created: "t.created_at DESC, t.id DESC",
      // §0 정규화와 **같은 식**이다. 두 곳에 다른 식이 있으면 순서가 다시 갈라진다.
      manual: "(t.sort_order = 0) ASC, t.sort_order ASC, t.created_at ASC, t.id ASC",
    } as const;
    type SortKey = keyof typeof ORDER_BY;
    /** 잘못된 값은 400 이 아니라 기본값으로 조용히 떨어뜨린다 — 주소는 사람이 손으로 고친다. */
    const rawSort = url.searchParams.get("sort");
    const sortKey: SortKey = (rawSort && rawSort in ORDER_BY ? rawSort : "due") as SortKey;

    const rows = await query<{
      id: number;
      title: string;
      description: string;
      status: string;
      priority: string;
      origin: string;
      project_id: number | null;
      project_name: string | null;
      color_key: string | null;
      assignee_id: number | null;
      assignee_name: string | null;
      area_id: number;
      area_name: string;
      work_type: string;
      start_date: string | null;
      due_date: string | null;
      goal_ids: number[] | null;
      progress: number;
      created_by_name: string | null;
      blocked: boolean;
      blocked_reason: string | null;
      blocked_by: number | null;
      visibility: "team" | "private";
      resolution: string | null;
      parent_task_id: number | null;
      sort_order: number;
      child_count: number;
      child_counted: number;
      child_done: number;
      completed_at: string | null;
      created_at: string;
    }>(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.origin,
              t.project_id, p.name AS project_name, p.color_key,
              t.assignee_id, a.display_name AS assignee_name,
              t.area_id, ar.name AS area_name, t.work_type,
              t.start_date::text, t.due_date::text,
              array_agg(gt.goal_id) FILTER (WHERE gt.goal_id IS NOT NULL) AS goal_ids,
              t.progress,
              c.display_name AS created_by_name,
              t.blocked, t.blocked_reason, t.blocked_by, t.visibility, t.resolution,
              t.parent_task_id, t.sort_order,
              (SELECT count(*)::int FROM task ck
                WHERE ck.parent_task_id = t.id AND ck.is_active = true) AS child_count,
              -- 진척은 목록에서도 **계산기 하나**를 통과해야 한다 (28-a).
              -- t.progress 를 그대로 내보내면 하위를 가진 업무가 목록에서는 0%,
              -- 상세에서는 50% 로 뜬다 — 같은 업무가 화면마다 다른 말을 한다.
              -- 여기서는 재료(집계 대상 하위 수 · 완료 수)만 싣고, 셈은 taskProgress() 가 한다.
              (SELECT count(*)::int FROM task ck
                WHERE ck.parent_task_id = t.id AND ${countableSql("ck")}) AS child_counted,
              (SELECT count(*)::int FROM task ck
                WHERE ck.parent_task_id = t.id AND ${countableSql("ck")}
                  AND ${doneSql("ck")}) AS child_done,
              t.completed_at::text, t.created_at::text
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id
       JOIN area ar ON ar.id = t.area_id
       LEFT JOIN actor a ON a.id = t.assignee_id
       LEFT JOIN actor c ON c.id = t.created_by
       LEFT JOIN goal_task gt ON gt.task_id = t.id
       WHERE t.is_active = true AND ${visibleTaskSql(viewerParam)}
         AND ( (${clauses()})
            -- 하위만 조건에 걸렸으면 **상위를 살려서** 보여준다 (§A3)
            OR EXISTS (SELECT 1 FROM task ch
                        WHERE ch.parent_task_id = t.id AND ch.is_active = true
                          AND ${visibleTaskSql(viewerParam, "ch")} AND (${asAlias("ch")}))
            -- 상위가 걸렸으면 하위가 따라 나온다 (§A3)
            OR EXISTS (SELECT 1 FROM task pa
                        WHERE pa.id = t.parent_task_id AND pa.is_active = true
                          AND ${visibleTaskSql(viewerParam, "pa")} AND (${asAlias("pa")})) )
       GROUP BY t.id, p.name, p.color_key, ar.name, a.display_name, c.display_name
       ORDER BY ${ORDER_BY[sortKey]}
       LIMIT 300`,
      params
    );

    // 인박스 — 에이전트 제안(proposed) 업무. 목록 필터와 무관하게 항상 함께 반환
    const inboxRows = await query<{
      id: number;
      title: string;
      description: string;
      project_name: string | null;
      color_key: string | null;
      assignee_id: number | null;
      assignee_name: string | null;
      due_date: string | null;
      created_by_name: string | null;
      created_at: string;
    }>(
      `SELECT t.id, t.title, t.description, p.name AS project_name, p.color_key,
              t.assignee_id, a.display_name AS assignee_name, t.due_date::text,
              c.display_name AS created_by_name, t.created_at::text
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id
       LEFT JOIN actor a ON a.id = t.assignee_id
       LEFT JOIN actor c ON c.id = t.created_by
       WHERE t.is_active = true AND t.status = 'proposed'
         AND ${visibleTaskSql("$1")}
       ORDER BY t.created_at ASC`,
      [session.id]
    );

    // 룩업 데이터(담당·프로젝트·목표)는 GET /api/meta/selectors로 분리됨 (Phase 8 D-3).
    const tasks: TaskListRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      origin: r.origin,
      projectId: r.project_id,
      projectName: r.project_name,
      colorKey: r.color_key,
      assigneeId: r.assignee_id,
      assigneeName: r.assignee_name,
      areaId: r.area_id,
      areaName: r.area_name,
      workType: r.work_type,
      startDate: r.start_date,
      dueDate: r.due_date,
      goalIds: r.goal_ids ?? [],
      // 28-a — **실효 진척**을 내보낸다. 하위가 있으면 하위 완료율이 이긴다.
      //   raw 값을 내보내면 목록은 0%, 상세는 50% 가 된다 — 같은 업무가 화면마다 다른 말을 한다.
      //   셈은 lib/progress.ts 의 taskProgress() 가 한다. 여기서 공식을 새로 쓰지 않는다.
      progress: taskProgress({
        status: r.status, progress: r.progress ?? 0, resolution: r.resolution,
        childCounted: r.child_counted, childDone: r.child_done,
      }),
      blocked: r.blocked ?? false,
      blockedReason: r.blocked_reason,
      blockedBy: r.blocked_by,
      visibility: r.visibility,
      createdByName: r.created_by_name,
      parentTaskId: r.parent_task_id,
      sortOrder: r.sort_order,
      childCount: r.child_count,
      completedAt: r.completed_at,
      createdAt: r.created_at,
    }));
    return NextResponse.json({
      tasks,
      inbox: inboxRows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        projectName: r.project_name,
        colorKey: r.color_key,
        assigneeId: r.assignee_id,
        assigneeName: r.assignee_name,
        dueDate: r.due_date,
        createdByName: r.created_by_name,
        createdAt: r.created_at,
      })),
      today,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession(); // Task 생성은 전원 (SPEC 6장 member 전권)
    const payload = await request.json();

    const title = String(payload.title ?? "").trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });
    const priority = (PRIORITIES as readonly string[]).includes(payload.priority)
      ? payload.priority
      : "mid";
    // 생성 가능한 상태만 허용(제안·중단 제외). 보드 상태 컬럼 "+추가" 프리셋 반영.
    const CREATABLE = ["todo", "doing", "review", "done"] as const;
    const status = (CREATABLE as readonly string[]).includes(payload.status)
      ? payload.status
      : "todo";
    const isDate = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const dueDate = isDate(payload.dueDate) ? payload.dueDate : null;
    const startDate = isDate(payload.startDate) ? payload.startDate : null;
    if (startDate && dueDate && startDate > dueDate) {
      return NextResponse.json({ error: "시작일이 마감일보다 늦을 수 없습니다." }, { status: 400 });
    }
    let areaId = payload.areaId ? Number(payload.areaId) : null;
    if (!areaId) {
      // 빠른 생성(⌘K 제목만) — 본인 소속 영역 우선, 없으면 첫 활성 영역으로 기본 배치
      const fallback = await queryOne<{ id: number }>(
        `SELECT a.id FROM area a
         LEFT JOIN actor_area aa ON aa.area_id = a.id AND aa.actor_id = $1
         WHERE a.is_active = true
         ORDER BY (aa.actor_id IS NULL), a.sort_order, a.id
         LIMIT 1`,
        [session.id]
      );
      areaId = fallback?.id ?? null;
    }
    if (!areaId) return NextResponse.json({ error: "업무 영역을 선택하세요." }, { status: 400 });
    const workType = (WORK_TYPES as readonly string[]).includes(payload.workType) ? payload.workType : "team";

    // 공개 범위 (§B1) — **기본값은 팀 공개.** 개인은 명시적으로 골라야 한다.
    // 실수로 개인이 되면 팀이 못 보고, 실수로 팀이 되면 남이 본다.
    // 후자가 되돌릴 수 없는 쪽이지만, 기본을 개인으로 두면 팀 업무가 조용히 사라진다.
    // 지시서가 팀 공개를 기본으로 정했고 그게 맞다 — 대신 화면에서 선택을 분명히 보인다.
    let visibility = isVisibility(payload.visibility) ? payload.visibility : "team";
    let projectId = payload.projectId ? Number(payload.projectId) : null;

    // ── §A2 하위 업무는 상위에서 물려받는다 ──────────────────────────
    // 프로젝트·영역·공개 범위를 따로 고르게 하지 않는다. 골라 보내와도 상위 값이 이긴다 —
    // 두 값이 다르면 "상위는 A 프로젝트인데 하위는 B" 라는 상태가 만들어지고,
    // 그때부터 어느 쪽이 맞는지 아무도 모른다.
    const parentTaskId = payload.parentTaskId ? Number(payload.parentTaskId) : null;
    if (parentTaskId !== null) {
      const chk = await checkParent(parentTaskId, null);
      if (chk.error) return NextResponse.json({ error: chk.error }, { status: 400 });
      projectId = chk.inherit!.projectId;
      areaId = chk.inherit!.areaId;
      visibility = chk.inherit!.visibility as typeof visibility;
    }

    // 개인 업무는 프로젝트에 속할 수 없다 (§A2). DB CHECK 가 최종 방어선이지만
    // 여기서 먼저 잡아 **사유를 사람 말로** 돌려준다 — 500 이 아니라 400 이어야 한다.
    if (visibility === "private" && projectId !== null) {
      return NextResponse.json(
        { error: "개인 업무는 프로젝트에 넣을 수 없습니다. 프로젝트는 팀 단위입니다." },
        { status: 400 }
      );
    }
    // 개인 업무는 남에게 배정할 수 없다 — 받는 사람이 볼 수 없는 업무가 된다.
    const assigneeId = payload.assigneeId ? Number(payload.assigneeId) : session.id;
    if (visibility === "private" && assigneeId !== session.id) {
      return NextResponse.json(
        { error: "개인 업무는 다른 사람에게 배정할 수 없습니다." },
        { status: 400 }
      );
    }

    const task = await queryOne<{ id: number }>(
      // goal_source 를 **명시**한다. 컬럼 기본값은 아직 'inherited' 이고(§A5 — 컬럼은 안 건드린다),
      // 상속이 사라진 뒤로 새 업무가 그 역사적 값을 갖게 두면 안 된다 (MD-P-2026-030 §A4).
      // sort_order — **맨 뒤**에 붙인다 (MD-P-2026-028 §C).
      //   컬럼 기본값이 0 이라, 023 backfill 이후에 만들어진 업무는 전부 0 이다.
      //   "직접 정한 순서" 로 보면 그 업무들이 **가장 앞**에 몰린다 — 새것이 위로 오는
      //   뒤집힌 순서다. 새로 만드는 것부터 형제 중 최대값+1 로 둔다.
      //   형제 기준은 parent_task_id 다 (§C3 — 순서는 같은 부모 안에서만 뜻이 있다).
      `INSERT INTO task (project_id, area_id, work_type, title, description, status, assignee_id, start_date, due_date, priority, origin, created_by, visibility, goal_source, parent_task_id, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'human',$11,$12,$13,$14,
               COALESCE((SELECT max(s.sort_order) + 1 FROM task s
                          WHERE s.is_active = true
                            AND s.parent_task_id IS NOT DISTINCT FROM $14), 1))
       RETURNING id`,
      [
        projectId,
        areaId,
        workType,
        title,
        String(payload.description ?? "").slice(0, 4000),
        status,
        assigneeId,
        startDate,
        dueDate,
        priority,
        session.id,
        visibility,
        NEW_TASK_GOAL_SOURCE,
        parentTaskId,
      ]
    );
    // 프로젝트를 골라도 목표는 따라 붙지 않는다 (§A4 — 상속 폐지).
    // 목표는 사람이 직접 고른다. 안 고른 업무는 목표 화면의 미연결 배너에 오른다.

    // 개인 업무는 **제목을 로그에 남기지 않는다** (§A3 ③).
    // task_id 로 걸러내긴 하지만, 문구 자체에 제목이 없어야 예전 로그·다른 경로에서도 안 샌다.
    await logActivity({
      userId: session.id,
      taskId: task!.id,
      message: visibility === "private"
        ? `${session.name}이(가) 개인 업무 생성`
        : `${session.name}이(가) 업무 생성 — "${title}"`,
    });
    return NextResponse.json({ id: task!.id });
  } catch (error) {
    return jsonError(error);
  }
}

// 업무 목록 내보내기 (MD-P-2026-066 §C-3).
//
// ── 화면과 **같은 조건**이다 ────────────────────────────────────
//
// 지시서 §C-21: 「지금 화면에 보이는 것과 같은 조건으로 나온다.」
// 그래서 조건을 여기서 새로 안 읽고 안 건다 — `lib/v3/list-query.ts` 의
// `parseListQuery()` · `selectRows()` 를 **화면과 똑같이** 부른다(§C-19).
//
// 이 파일이 혼자 하는 일은 셋뿐이다:
//   ① 재료를 DB 에서 긁어 온다 (권한 조건은 `visibleTaskSql` 그대로)
//   ② 고른 행을 글자로 바꾼다 (`lib/csv.ts` — BOM · 수식 주입 막기)
//   ③ 파일로 내려보낸다
//
// ── 권한은 **두 겹**이다 (§C-20) ────────────────────────────────
//
// SQL 이 `visibleTaskSql()` 로 남의 개인 업무를 빼고, `selectRows()` 가 행마다
// 한 번 더 묻는다. 두 번째 그물은 평소 아무것도 안 잡는다 — **안 잡히는 것이
// 정상이고, 그물이 없는 것이 사고다.** 화면은 막혀 있는데 파일로는 나가는
// 사고가 이 조합에서만 안 난다.
//
// ── 왜 `<a href>` 로만 부르는가 (§C-22) ────────────────────────
//
// 이 경로는 GET 이고, 부르면 전 건을 읽어 파일을 만든다. 화면이 `<Link>` 로
// 걸면 Next 가 **미리 불러오기**를 하면서 사람이 누르지 않아도 만들어진다.
// 그래서 단추는 평범한 `<a href>` 다 — 그 판단은 `TasksView` 쪽에 적어 뒀다.
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { kstToday } from "@/lib/home";
import { visibleTaskSql } from "@/lib/visibility";
import { countableSql, doneSql, taskProgress } from "@/lib/progress";
import { STATUS_META } from "@/lib/task-view";
import { parseListQuery, selectRows, type SelectableRow } from "@/lib/v3/list-query";
import { toCsv, csvFilename } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 열 이름. **사람이 읽는 말**이다 — 엑셀에서 그대로 머리줄이 된다. */
const HEADER = [
  "번호", "제목", "영역", "프로젝트", "상태", "우선순위", "담당", "시작일", "기한", "진척(%)",
] as const;

/** 우선순위 — 화면과 같은 말로 적는다. 영문 코드를 파일에 내보내지 않는다. */
const PRIORITY_LABEL: Record<string, string> = { high: "높음", mid: "보통", low: "낮음" };

interface Row extends SelectableRow {
  priority: string;
  projectName: string | null;
  areaName: string;
  startDate: string | null;
  progress: number;
}

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    // **주소를 화면과 같은 함수로 읽는다.** 여기서 `searchParams.get` 을 직접
    // 쓰기 시작하면 그 순간부터 두 벌이다.
    const q = parseListQuery(url.searchParams);
    const today = kstToday();

    const raw = await query<{
      id: number; title: string; status: string; priority: string;
      area_id: number; area_name: string; project_name: string | null;
      assignee_id: number | null; assignee_name: string | null;
      start_date: string | null; due_date: string | null;
      visibility: string; created_by: number | null;
      progress: number; resolution: string | null;
      child_counted: number; child_done: number;
      parent_task_id: number | null; completed_at: string | null; description: string;
    }>(
      `SELECT t.id, t.title, t.status, t.priority,
              t.area_id, ar.name AS area_name, p.name AS project_name,
              t.assignee_id, a.display_name AS assignee_name,
              t.start_date::text, t.due_date::text,
              t.visibility, t.created_by, t.progress, t.resolution,
              (SELECT count(*)::int FROM task ck
                WHERE ck.parent_task_id = t.id AND ${countableSql("ck")}) AS child_counted,
              (SELECT count(*)::int FROM task ck
                WHERE ck.parent_task_id = t.id AND ${countableSql("ck")}
                  AND ${doneSql("ck")}) AS child_done,
              t.parent_task_id, t.completed_at::text, t.description
         FROM task t
         JOIN area ar ON ar.id = t.area_id
         LEFT JOIN project p ON p.id = t.project_id
         LEFT JOIN actor a ON a.id = t.assignee_id
        WHERE t.is_active = true AND t.status <> 'proposed'
          AND ${visibleTaskSql("$1")}
        ORDER BY t.id`,
      [session.id]
    );

    const rows: Row[] = raw.map((r) => ({
      id: r.id, title: r.title, status: r.status, priority: r.priority,
      areaId: r.area_id, areaName: r.area_name, projectName: r.project_name,
      assigneeId: r.assignee_id, assigneeName: r.assignee_name,
      startDate: r.start_date, dueDate: r.due_date,
      visibility: r.visibility, createdById: r.created_by,
      // 진척은 **계산기 하나**를 지난다(28-a). 여기서 `t.progress` 를 그대로
      // 내보내면 하위를 가진 업무가 파일에서는 0%, 화면에서는 50% 가 된다.
      progress: taskProgress({
        status: r.status, progress: r.progress ?? 0, resolution: r.resolution,
        childCounted: r.child_counted, childDone: r.child_done,
      }),
      parentTaskId: r.parent_task_id, completedAt: r.completed_at,
      description: r.description,
      // 목록 행이 들고 다니는 칸(067 §B-8). CSV 는 이 값을 안 내보내지만,
      // **같은 함수를 지나려면 같은 모양**이어야 한다.
      goalIds: [],
    }));

    // **화면과 같은 함수.** 조건도 권한도 이 한 줄을 지난다.
    const picked = selectRows(rows, q, session.id, today);

    const body = toCsv(HEADER, picked.map((t) => [
      t.id, t.title, t.areaName, t.projectName,
      STATUS_META[t.status]?.label ?? t.status,
      PRIORITY_LABEL[t.priority] ?? t.priority,
      t.assigneeName, t.startDate, t.dueDate, t.progress,
    ]));

    /*
     * 파일 이름은 **두 벌**로 적는다. 헤더 값에 한글을 그대로 쓰면 Node 가
     * latin-1 만 받아서 던진다 — 내보내기 전체가 500 이 된다. 그래서
     * ASCII 이름을 `filename` 에, 한글 이름을 `filename*` 에 담는다.
     * 한글을 못 읽는 오래된 내려받개도 파일은 받는다.
     */
    const ascii = csvFilename("tasks", today);
    const korean = encodeURIComponent(csvFilename("업무", today));

    return new Response(body, {
      status: 200,
      headers: {
        // `charset=utf-8` 과 BOM 을 **둘 다** 둔다. 엑셀은 BOM 을 보고,
        // 브라우저·스프레드시트 웹앱은 헤더를 본다.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${korean}`,
        // 조건이 바뀌면 다른 파일이다. 캐시가 앞의 조건을 돌려주면
        // 「화면과 같은 조건」이 깨진다.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

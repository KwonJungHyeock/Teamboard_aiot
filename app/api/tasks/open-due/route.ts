// 가오픈 기준 기한 집계 — **읽기 전용** (MD-P-2026-041 §C).
//
// ── 왜 화면이 필요한가 ───────────────────────────────────────────
//
// 세 갈래 집계가 037 에서 만들어졌는데 **검사기 안에서만** 돌았다. 지시자는
// Neon 을 못 열고 SQL 도 못 돌리므로, 화면으로 내지 않으면 이 숫자를 볼 사람이
// 아무도 없다. 계산은 이미 `lib/open-due.ts` 에 있다 — 여기서는 재료만 모은다.
//
// ── 누가 보는가 ──────────────────────────────────────────────────
//
// **팀장까지**다(`requireLiveLead`). 관리자 전용이 아니다 — 기한을 조정하는 것은
// 팀장의 일이지 관리자의 일이 아니다.
//
// ── 무엇을 세는가 ────────────────────────────────────────────────
//
// 활성 업무 전부. 남의 개인 업무는 **세지도 않는다**(`visibleTaskCountSql`) —
// 진척 분모에 남의 개인 업무가 들어가면 숫자로 존재가 새어 나간다.
// 완료는 세 갈래에서 빠지고, 뺀 수를 따로 낸다(`tallyOpenDue`).
//
// 쓰기 경로가 없다. UPDATE 도 DELETE 도 이 파일에 없다.
import { NextResponse } from "next/server";
import { requireLiveLead } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { query } from "@/lib/db";
import { visibleTaskCountSql } from "@/lib/visibility";
import { getPlatformOpen } from "@/lib/platform-config";
import { openDueMark, tallyOpenDue } from "@/lib/open-due";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  id: number;
  title: string;
  status: string;
  due_date: string | null;
  assignee: string | null;
  area: string | null;
  project: string | null;
}

export async function GET() {
  try {
    const session = await requireLiveLead();
    const { openAt } = await getPlatformOpen();
    const openAtMs = Date.parse(openAt);

    const rows = await query<Row>(
      // 영역은 **업무에 직접 붙어 있다**(`task.area_id`, NOT NULL). 프로젝트를
      // 거쳐 읽으면 프로젝트 없는 업무가 영역 없는 것처럼 보인다 — 실제로 그렇게
      // 나왔다. 프로젝트는 별개 값으로 함께 낸다.
      `SELECT t.id, t.title, t.status, t.due_date::text,
              ac.display_name AS assignee, ar.name AS area, p.name AS project
         FROM task t
         LEFT JOIN actor   ac ON ac.id = t.assignee_id
         LEFT JOIN project p  ON p.id  = t.project_id
         LEFT JOIN area    ar ON ar.id = t.area_id
        WHERE t.is_active = true AND ${visibleTaskCountSql("$1")}
        ORDER BY t.due_date NULLS LAST, t.id`,
      [session.id]
    );

    const tally = tallyOpenDue(rows.map((r) => ({ status: r.status, dueDate: r.due_date })), openAtMs);

    // 목록은 **손댈 것이 있는 두 갈래**만 낸다 — 가오픈 뒤 · 기한 없음.
    // 「가오픈 전」은 그대로 두면 되는 것들이라 건수로 충분하다.
    const pick = (want: "after" | "none") =>
      rows
        .filter((r) => r.status !== "done" && openDueMark(r.due_date, openAtMs).bucket === want)
        .map((r) => {
          const m = openDueMark(r.due_date, openAtMs);
          return {
            id: r.id,
            title: r.title,
            status: r.status,
            dueDate: r.due_date,
            assignee: r.assignee,
            area: r.area,
            project: r.project,
            // 「가오픈보다 며칠 뒤인가」 — 대문 카운트다운과 같은 곳에서 센 값이다.
            daysAfterOpen: m.days === null ? null : -m.days,
            label: m.label,
          };
        });

    return NextResponse.json({
      openAt,
      tally,
      // 총합이 맞는지 화면에서도 볼 수 있게 **전체 수를 함께 낸다.**
      // 세 갈래 + 완료제외 = 전체. 안 맞으면 세다가 빠뜨린 것이다.
      totalActive: rows.length,
      after: pick("after"),
      none: pick("none"),
    });
  } catch (error) {
    return jsonError(error);
  }
}

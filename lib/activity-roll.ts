// 레일 「팀 활동」 — 연속된 같은 활동을 한 줄로 묶는다 (MD-P-2026-031 §C3 · 2-2-2).
//
// ── 왜 묶는가 ────────────────────────────────────────────────────
//
// 레일은 여섯 칸뿐이다. 한 사람이 같은 업무를 세 번 만지면 칸을 다 잡아먹는다.
// 가정이 아니라 **본 것**이다 — 지금 로컬 로그의 최근 여섯 줄 중 셋이
// 같은 사람 · 같은 업무 · 같은 종류의 진행률 변경이었다(1분 안에 세 번).
//
// **서버에서 묶는다.** 화면에서 묶으면 6건을 받아 3건만 그리게 된다 —
// 「LIMIT 은 정렬 뒤에 걸린다」와 같은 이야기다. 자를 것을 자른 **뒤**에 세어야 한다.
//
// ── 무엇을 같은 것으로 보는가 ────────────────────────────────────
//
//   같은 사람 · 같은 대상 · 같은 종류 · **1시간 안**
//
// 대상은 `task_id` 가 있으면 그것, 없으면 문구에서 따옴표 안의 이름을 쓴다.
// 종류는 문구의 **동사 부분**이다 — `진행률 변경` · `목표 수정` · `업무 상태 변경`.
// 셋 중 하나라도 다르면 다른 줄이다. 시간이 벌어져도 다른 줄이다 —
// **어제 한 일과 오늘 한 일은 같은 일이 아니다.**
import type { ActivityEntry } from "./types";

export interface RolledActivity {
  /** 대표 행의 id — 화면 key */
  id: number;
  userName: string | null;
  /** 묶인 줄의 **가장 최근** 시각. 묶었다고 옛 시각을 쓰지 않는다. */
  at: string;
  /** 사람 이름과 동사를 뺀 나머지 — 화면이 이름을 따로 그린다 */
  text: string;
  /** 묶인 개수. 1이면 화면에 안 적는다 — `1회` 는 정보가 아니다. */
  count: number;
  taskId: number | null;
}

/** 로그 문구에서 사람 이름을 뗀다 — `권정혁이(가) 진행률 변경 …` → `진행률 변경 …` */
function stripActor(message: string): string {
  return message.replace(/^.+?이\(가\)\s*/, "");
}

/**
 * 묶음 열쇠. **문구 전체를 쓰지 않는다** — `(0% → 90%)` 처럼 매번 바뀌는 값이 들어 있어
 * 전체로 비교하면 아무것도 안 묶인다. 동사와 대상만 남긴다.
 */
function groupKey(e: ActivityEntry): string {
  const body = stripActor(e.message);
  const verb = body.replace(/\s*\(.*?\)\s*/g, " ").split("—")[0].trim();   // 괄호 안 수치 제거
  const target = e.task_id ?? (/[""“”'](.+?)[""“”']/.exec(body)?.[1] ?? "");
  return `${e.user_id ?? "?"}|${verb}|${target}`;
}

const HOUR = 60 * 60 * 1000;

/**
 * 연속 묶기. **정렬된 입력**(최신 → 과거)을 받는다.
 * 이웃끼리만 본다 — 사이에 다른 활동이 끼면 그건 끊긴 것이다.
 * 「A A B A」 를 「A×3, B」 로 묶으면 시간 순서가 거짓이 된다.
 */
export function rollActivity(rows: ActivityEntry[], limit = 6): RolledActivity[] {
  const out: RolledActivity[] = [];
  let key: string | null = null;

  for (const e of rows) {
    const k = groupKey(e);
    const last = out[out.length - 1];
    const near = last && new Date(last.at).getTime() - new Date(e.created_at).getTime() < HOUR;
    if (last && k === key && near) {
      last.count += 1;
      /**
       * **묶이는 순간 괄호 안 수치를 뗀다.**
       * `진행률 변경 (80% → 35%)` 를 14건의 대표로 쓰면 나머지 13건에 대해 거짓말이 된다.
       * 한 건일 때만 그 값이 그 사건을 정확히 설명한다.
       */
      last.text = last.text.replace(/\s*\([^)]*\)/, "");
      continue;   // 시각은 그대로 둔다 — 첫 행이 가장 최근이다
    }
    if (out.length >= limit) break;
    out.push({
      id: e.id,
      userName: e.user_name ?? null,
      at: e.created_at,
      text: stripActor(e.message),
      count: 1,
      taskId: e.task_id ?? null,
    });
    key = k;
  }
  return out;
}

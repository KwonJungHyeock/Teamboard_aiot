// 사람 줄 안전망 — **시작 전 모습과 끝난 뒤를 대조한다** (MD-P-2026-074 §C-19 · 072 §G).
//
// 검사기가 사람의 줄을 바꾸거나 지웠는지 **끝날 때** 본다. 다르면 그 목록을 돌려주고,
// 부르는 쪽이 빨강으로 낸다. **되돌리지는 않는다** — 무엇이 원래 값인지는 검사기마다
// 다르고, 여기서 일괄로 덮으면 도는 동안 사람이 바꾼 것까지 덮는다.
//
// 보는 것 — 073 §B 가 센 「높음」 넷과 기록 다섯이 건드리던 자리:
//   업무(상태 · 진행률 · 완료 시각 · 사유 · 기한 · 활성 · 제목 · 순서 · 고친 시각) · 목표(제목 · 활성 · 진척) ·
//   저장한 보기(있음 · 이름 · 순서) · 인수인계(있음) · 계정(역할 · 관리자 권한 · 안내 봤음)
//
// 「제 줄」은 **이번 판에 생긴 줄**(시작 때의 최대 id 보다 큰 것)이다. 이름 표식으로 고르지
// 않는다 — 사람이 같은 글자를 쓸 수 있다. 제 줄이 아닌데 시작 전에 없던 것도 안 본다
// (도는 동안 사람이 새로 만든 것일 수 있다) — 보는 것은 **있던 줄이 바뀌었거나 사라졌는가**다.
//
// 쓰는 법
//   import { peopleSnapshot, peopleDiff } from "./people-guard.mjs";
//   const guard = await peopleSnapshot(pool);            // try 맨 앞에서
//   …
//   const diff = await peopleDiff(pool, guard);          // finally 에서, 제 줄을 지운 뒤
//   console.log(`사람 줄 대조 — 다른 것 ${diff.length}건${diff.length ? ` [${diff.slice(0, 5).join(" · ")}]` : ""}`);
//   if (diff.length) process.exitCode = 1;

const TABLES = {
  // 076 §A — 순서(sort_order)와 고친 시각(updated_at)도 본다. 순서 저장은 형제 전체에 번호를 다시
  // 매기고 고친 시각을 적는다 — 값이 같아도 고친 시각은 남으므로 「누가 적었는가」까지 잡힌다
  task: `SELECT id, concat_ws('|', status, progress, completed_at::text, resolution, due_date::text, is_active, title,
                              sort_order, updated_at::text) v FROM task`,
  // 076 §A — 진척(저장값)도 본다. 목표 연결을 재는 검사가 사람의 분기 목표 진척을 다시 계산해
  // 바꿔 두던 자리다. 읽기는 재계산하지 않으므로(lib/goals.ts) 바뀌었으면 누가 연결·진척을 건드린 것이다.
  // 재계산은 값이 같아도 고친 시각(updated_at)을 적는다 — 그래서 그것도 본다
  goal: `SELECT id, concat_ws('|', title, is_active, progress, progress_auto, updated_at::text) v FROM goal`,
  saved_view: `SELECT id, concat_ws('|', name, sort_order) v FROM saved_view`,
  handover: `SELECT id, '있음' v FROM handover`,
  account: `SELECT actor_id AS id, concat_ws('|', role, admin_grant, onboarded_at::text) v FROM account`,
};

/** 시작 전 모습 — 표마다 id → 값 */
export async function peopleSnapshot(pool) {
  const snap = {};
  for (const [t, q] of Object.entries(TABLES)) {
    snap[t] = new Map((await pool.query(q)).rows.map((r) => [r.id, r.v]));
  }
  return snap;
}

/**
 * 시작 전에 **있던** 줄 중 바뀌었거나 사라진 것. 「표 #id 무엇」 줄의 목록.
 * @param skip 표 → 대조에서 뺄 id 들 (검사기가 **제 줄로 알고 되돌리는** 것만. 예: 없음이 정상)
 */
export async function peopleDiff(pool, snap, skip = {}) {
  const out = [];
  for (const [t, q] of Object.entries(TABLES)) {
    const now = new Map((await pool.query(q)).rows.map((r) => [r.id, r.v]));
    const sk = new Set(skip[t] ?? []);
    for (const [id, v] of snap[t]) {
      if (sk.has(id)) continue;
      if (!now.has(id)) out.push(`${t} #${id} 사라짐`);
      else if (now.get(id) !== v) out.push(`${t} #${id} 바뀜`);
    }
  }
  return out;
}

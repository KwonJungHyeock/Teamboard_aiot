// §A3 귀속 대상 조사 (MD-P-2026-032) — **읽기 전용. 아무것도 바꾸지 않는다.**
//
// 프로젝트 없는 업무를 어디로 보낼지 **PM 이 보고 정할 수 있게** 표로 낸다.
// 「자동으로 옮기기 전에 목록을 제출한다」(§A3).
//
// 열 구성
//   id · 제목 · 영역 · 갈 상시 프로젝트(제안) · **제목에서 읽히는 추정 프로젝트**
//
// ── 「추정」이라는 말을 열 이름에 적는 이유 ───────────────────────
// 이 열은 **자동 배정에 쓰지 않는다.** PM 이 「이건 EDUINO AI 로 가야 한다」고
// 지정할 때 쓰는 재료다. 근거(어느 낱말에 걸렸는지)를 함께 적어
// **왜 그렇게 읽혔는지 되짚을 수 있게** 한다.
//
// ── 접두어는 프로젝트가 아니다 ────────────────────────────────────
// `[플랫폼]` · `[R&D]` · `[기타]` 같은 접두어가 많은데 **전부 영역 이름**이다.
// 접두어만 보면 이미 아는 것(영역)을 다시 말할 뿐이라, 본문 낱말도 함께 본다.
//
// ── 영역이 다르면 그대로는 못 옮긴다 ──────────────────────────────
// `trg_task_area_match` 가 `task.area_id = project.area_id` 를 강제한다.
// 추정 프로젝트의 영역이 업무 영역과 다르면 **영역도 함께 바꿔야** 하고,
// 그건 다른 판단이다. 그 사실을 표에 적는다.
//
// ── ⚠ 다시 돌려서 덮어쓰지 말 것 ──────────────────────────────────
// `docs/audit/032/A3-귀속대상.md` 는 **배치 ③ 실행 직전의 스냅샷**이다.
// 지금 이 스크립트를 돌리면 **0건**이 나온다 — 19건이 이미 옮겨졌기 때문이다.
// 실제로 한 번 덮어써서 되돌렸다. 그 표의 값은 「옮기기 전의 모습」에 있다.
//
//   node scripts/a3-orphan-tasks.mjs            # 화면으로만 본다
//   node scripts/a3-orphan-tasks.mjs > 새파일    # 남길 거면 새 이름으로
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("a3-orphan-tasks.mjs");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;

/**
 * 제목에서 프로젝트를 **추정**하는 규칙.
 *
 * 규칙을 데이터로 둔다 — 코드에 흩어 두면 왜 그렇게 읽혔는지 못 되짚는다.
 * `words` 중 하나라도 제목에 있으면 후보로 올린다. 근거를 그 낱말로 적는다.
 */
const HINTS = [
  { project: "EDUINO AI", words: ["EDUINO", "에듀이노", "차시", "수행평가", "평가문항", "교육자료", "Appinventor"] },
  { project: "Playino", words: ["Playino", "플레이이노", "플레이노"] },
  { project: "AI 학습추론모델", words: ["학습추론", "추론모델", "센서 모듈", "AIoT"] },
];

try {
  const areas = await sql(
    `SELECT id, name, kind, is_active, sort_order FROM area ORDER BY sort_order, id`
  );
  const projects = await sql(
    `SELECT id, name, area_id FROM project WHERE is_active ORDER BY id`
  );
  const byArea = new Map(areas.map((a) => [a.id, a]));
  const projByName = new Map(projects.map((p) => [p.name, p]));

  const tasks = await sql(
    `SELECT t.id, t.title, t.area_id, t.status, t.assignee_id, ac.display_name AS assignee
       FROM task t
       LEFT JOIN actor ac ON ac.id = t.assignee_id
      WHERE t.is_active AND t.project_id IS NULL
      ORDER BY t.area_id, t.id`
  );

  const guessOf = (title) => {
    const hits = [];
    for (const h of HINTS) {
      const w = h.words.find((x) => title.toLowerCase().includes(x.toLowerCase()));
      if (w) hits.push({ project: h.project, why: w });
    }
    return hits;
  };

  const L = (s) => console.log(s);
  L(`# MD-P-2026-032 §A3 — 귀속 대상 목록 (실행 전 제출 · 읽기 전용 조사)`);
  L(``);
  L(`프로젝트 없는 활성 업무 **${tasks.length}건**. 로컬 시드 기준.`);
  L(``);
  L(`> **이 표는 실행 목록이 아니라 §B 완료 후 사람이 보고 판단할 목록이다.**`);
  L(`>`);
  L(`> 마이그레이션(배치 ③)은 **19건 전부를 자기 영역의 상시 프로젝트로** 보낸다.`);
  L(`> 「추정 프로젝트」는 **실행하지 않는다** — 추정만으로 프로젝트와 영역 둘을 한 번에`);
  L(`> 바꾸면 되돌리기 어렵고, 틀렸을 때 어디까지 되돌려야 하는지가 흐려진다.`);
  L(`>`);
  L(`> §B 가 하려는 일이 바로 그 이동을 3초로 만드는 것이다 — 프로젝트 버튼 하나를 누르면`);
  L(`> 영역·목표가 따라온다. **사람이 화면에서 하는 것이 더 정확하고 더 빠르다.**`);
  L(`> 그때 「추정 프로젝트」와 「따르면 영역도 바뀐다」 두 열이 값을 한다.`);
  L(``);
  L(`## 영역 현황`);
  L(``);
  L(`| id | 영역 | kind | 활성 | 프로젝트 없는 업무 |`);
  L(`| --- | --- | --- | --- | --- |`);
  for (const a of areas) {
    const n = tasks.filter((t) => t.area_id === a.id).length;
    L(`| ${a.id} | ${a.name} | ${a.kind} | ${a.is_active ? "활성" : "**비활성**"} | ${n} |`);
  }
  L(``);
  L(`## 귀속 대상`);
  L(``);
  L(`| id | 제목 | 영역 | 담당 | 갈 상시 프로젝트(제안) | 제목에서 읽히는 **추정** 프로젝트 | 추정 근거 | 비고 |`);
  L(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const t of tasks) {
    const a = byArea.get(t.area_id);
    const standing = `상시 · ${a?.name ?? `영역 ${t.area_id}`}`;
    const hits = guessOf(t.title);
    const guess = hits.map((h) => h.project).join(" 또는 ") || "—";
    const why = hits.map((h) => `\`${h.why}\``).join(" · ") || "—";
    // 추정 프로젝트의 영역이 업무 영역과 다르면 트리거가 막는다. 그 사실을 적는다.
    const notes = [];
    for (const h of hits) {
      const p = projByName.get(h.project);
      if (p && p.area_id !== t.area_id) {
        notes.push(`${h.project} 는 **${byArea.get(p.area_id)?.name}** 영역 — 옮기려면 업무 영역도 함께 바꿔야 한다`);
      }
    }
    if (a && !a.is_active) notes.push(`**비활성 영역**이다 — 여기에 상시 프로젝트를 만들지 판단 필요`);
    if (a && a.kind !== "workspace") notes.push(`**${a.kind}** 영역이다 — 작업 공간이 없는 영역으로 규정돼 있다`);
    L(`| ${t.id} | ${t.title} | ${a?.name ?? "?"} | ${t.assignee ?? "—"} | ${standing} | ${guess} | ${why} | ${notes.join(" / ") || "—"} |`);
  }
  L(``);
  L(`## 만들어야 할 상시 프로젝트`);
  L(``);
  const need = [...new Set(tasks.map((t) => t.area_id))].map((id) => byArea.get(id)).filter(Boolean);
  L(`업무가 남아 있는 영역 기준 **${need.length}개**.`);
  L(``);
  L(`| 영역 | kind | 활성 | 만들 프로젝트 이름 | 판단 필요 |`);
  L(`| --- | --- | --- | --- | --- |`);
  for (const a of need) {
    const flag = !a.is_active ? "비활성 영역" : a.kind !== "workspace" ? `${a.kind} 영역` : "—";
    L(`| ${a.name} | ${a.kind} | ${a.is_active ? "활성" : "비활성"} | 상시 · ${a.name} | ${flag} |`);
  }
  L(``);
  const wsActive = areas.filter((a) => a.is_active && a.kind === "workspace");
  L(`참고 — **활성 workspace 영역은 ${wsActive.length}개**(${wsActive.map((a) => a.name).join(" · ")}).`);
  L(`지시서의 「일곱 개」와 다르다. 전체 영역 행이 ${areas.length}개이고,`);
  L(`그중 \`교육자료\`는 \`link_only\`, \`기타\`는 \`is_active = false\` 다.`);
} catch (e) {
  console.error(String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  try { await pool.end(); } catch { /* 종료 경로 */ }
}

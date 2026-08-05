// Private Blob 접근 권한 회귀 테스트 (MD-P-2026-014a P1)
//
// 무엇을 지키는가
//   "그 pathname 이 엔티티에 실제로 저장돼 있을 때만 읽을 수 있다"
//   저장 전에는 거부, 저장 후에는 통과, 지우면 다시 거부 — 이 왕복이 깨지면 P1 이 재발한다.
//   프로젝트 멤버십은 조건이 아니다(멤버가 없는 프로젝트에서도 소유자·리드가 읽을 수 있어야 한다).
//
// 실행
//   1) 앱을 프로덕션 빌드로 띄운다 (스토리지 게이트만 열면 된다 — 실제 토큰 불필요)
//        BLOB_READ_WRITE_TOKEN=dummy npx next start -p 3411 > /tmp/blob.log 2>&1 &
//   2) 세션 토큰을 /tmp/tok.txt 에 둔다 (AUTH_SECRET 으로 서명한 lead 세션)
//   3) DATABASE_URL=... BLOB_LOG=/tmp/blob.log node scripts/verify-blob-access.mjs
//
// 판별 방법
//   응답은 정책상 전부 404 다(존재 여부 비노출). 그래서 서버 로그로 단계를 가른다.
//     [blob] denied by access check → 인가에서 막힘
//     [blob] storage error          → 인가 통과 (그 뒤 스토리지 단계)
//
// 검증에 쓴 데이터는 스스로 원복한다.

import { execSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://localhost:3411";
const LOG = process.env.BLOB_LOG;
const TOK = fs.readFileSync("/tmp/tok.txt", "utf8").trim();
const PSQL = (sql) =>
  execSync(`psql "${process.env.DATABASE_URL}" -qtA -c ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();

let pass = 0, fail = 0;
const ok = (n, c, note = "") => { c ? pass++ : fail++; console.log(`${c ? "O" : "X"} ${n}${note ? "  — " + note : ""}`); };

async function probe(pathname) {
  const before = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").length : 0;
  const res = await fetch(`${BASE}/api/blob?pathname=${encodeURIComponent(pathname)}`, {
    headers: { Cookie: `tb_session=${TOK}` },
  }).catch(() => null);
  await new Promise((r) => setTimeout(r, 400));
  const tail = fs.readFileSync(LOG, "utf8").slice(before);
  const stage = tail.includes("denied by access check") ? "denied"
    : tail.includes("storage error") || tail.includes("storage returned null") ? "authorized"
    : "unknown";
  return { status: res ? res.status : "ERR", stage };
}

const U = "0123abcd-1234-5678-9abc-def012345678";

(async () => {
  // ── 프로젝트 캔버스: 멤버가 없는 프로젝트에서 소유자가 읽을 수 있어야 한다 ──
  const P = `projects/1/canvas/${U}-regress.png`;
  console.log("프로젝트 1 담당 인원(actor_area/멤버 개념) 확인:",
    PSQL("SELECT count(*) FROM task WHERE project_id=1 AND assignee_id IS NOT NULL AND is_active") + "명이 업무 담당");

  let r = await probe(P);
  ok("저장 전 → 인가에서 거부", r.stage === "denied" && r.status === 404, `${r.status} / ${r.stage}`);

  PSQL(`UPDATE project_canvas SET blocks = blocks || jsonb_build_array(jsonb_build_object('id','bregress','type','image','pathname','${P}','name','regress.png')) WHERE project_id=1`);
  r = await probe(P);
  ok("저장 후 → 인가 통과 (멤버 없는 프로젝트에서 소유자·리드가 읽을 수 있다)",
     r.stage === "authorized", `${r.status} / ${r.stage}`);

  PSQL(`UPDATE project_canvas SET blocks = (SELECT coalesce(jsonb_agg(b),'[]'::jsonb) FROM jsonb_array_elements(blocks) b WHERE b->>'id' <> 'bregress') WHERE project_id=1`);
  r = await probe(P);
  ok("블록 삭제 후 → 다시 거부", r.stage === "denied", `${r.status} / ${r.stage}`);

  // ── 업무 문서 ──
  const T = `tasks/84/doc/${U}-regress.png`;
  r = await probe(T);
  ok("업무: 저장 전 → 거부", r.stage === "denied", `${r.status} / ${r.stage}`);
  PSQL(`UPDATE task SET doc = doc || jsonb_build_array(jsonb_build_object('id','bregress','type','image','pathname','${T}')) WHERE id=84`);
  r = await probe(T);
  ok("업무 문서에 저장 후 → 통과", r.stage === "authorized", `${r.status} / ${r.stage}`);
  PSQL(`UPDATE task SET doc = '[]'::jsonb WHERE id=84`);

  // ── 설명(description) 마크다운 이미지 — 이전에는 doc 만 봐서 영구 404 였다 ──
  r = await probe(T);
  ok("설명에 넣기 전 → 거부", r.stage === "denied", `${r.status} / ${r.stage}`);
  PSQL(`UPDATE task SET description = coalesce(description,'') || '![regress](/api/blob?pathname=${T})' WHERE id=84`);
  r = await probe(T);
  ok("설명 마크다운 참조 → 통과 (P1 후속 수정)", r.stage === "authorized", `${r.status} / ${r.stage}`);
  PSQL(`UPDATE task SET description = replace(description, '![regress](/api/blob?pathname=${T})', '') WHERE id=84`);
  {
    const left = PSQL(`SELECT position('regress' in coalesce(description,'')) FROM task WHERE id=84`);
    ok("설명 정리 완료(검증 흔적 없음)", left === "0", `position=${left}`);
  }

  // ── 코멘트 본문 참조 ──
  const cid = PSQL(`INSERT INTO task_comment (task_id, author_id, body) VALUES (84, 1, '![c](/api/blob?pathname=${T})') RETURNING id`);
  r = await probe(T);
  ok("코멘트 마크다운 참조 → 통과 (P1 후속 수정)", r.stage === "authorized", `${r.status} / ${r.stage}`);
  PSQL(`DELETE FROM task_comment WHERE id=${cid}`);
  r = await probe(T);
  ok("코멘트 삭제 후 → 다시 거부", r.stage === "denied", `${r.status} / ${r.stage}`);

  // ── 권한 경계가 느슨해지지 않았는지 ──
  r = await probe(`projects/2/canvas/${U}-other.png`);
  ok("다른 프로젝트의 미참조 경로 → 거부", r.stage === "denied", `${r.status} / ${r.stage}`);
  const anon = await fetch(`${BASE}/api/blob?pathname=${encodeURIComponent(P)}`);
  ok("세션 없음 → 401 유지", anon.status === 401, `status ${anon.status}`);

  console.log(`\n=== ${pass}/${pass + fail} 통과 ===`);
  console.log("정리 후 상태:",
    "canvas blocks =", PSQL("SELECT jsonb_agg(b->>'type') FROM project_canvas c, jsonb_array_elements(c.blocks) b WHERE c.project_id=1"),
    "| task84 doc =", PSQL("SELECT jsonb_array_length(doc) FROM task WHERE id=84"),
    "| task84 desc len =", PSQL("SELECT length(coalesce(description,'')) FROM task WHERE id=84"));
  process.exit(fail ? 1 : 0);
})();

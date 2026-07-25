// 데모 데이터 시드 (Phase 3 완료 기준 검증용) — 프로토타입 v0.3 데모 내용을 재현.
// 운영 시드(init-db.mjs)와 분리. 사용법: DATABASE_URL=... npm run db:seed-demo
// 중복 방지: config.demo_seeded 마커. 재실행 시 건너뜀.
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = (text, params = []) => pool.query(text, params);

const seeded = await q("SELECT 1 FROM config WHERE key = 'demo_seeded'");
if (seeded.rows.length > 0) {
  console.log("이미 데모 시드가 적용되어 있습니다. (config.demo_seeded)");
  await pool.end();
  process.exit(0);
}

// 기준 actor/프로젝트 조회
const actor = async (name) =>
  (await q("SELECT id FROM actor WHERE display_name = $1 AND type='human'", [name])).rows[0]?.id;
const agentOf = async (ownerId) =>
  (await q("SELECT id FROM actor WHERE type='agent' AND owner_actor_id = $1", [ownerId])).rows[0]?.id;
const project = async (name) =>
  (await q("SELECT id FROM project WHERE name = $1", [name])).rows[0]?.id;

const kwon = await actor("권정혁");
const park = await actor("박주희");
const jo = await actor("조서연");
const edu = await project("EDUINO AI");
const play = await project("Playino");
const train = await project("AI 트레이너");
if (!kwon || !park || !jo || !edu) {
  console.error("기본 시드(npm run db:init)를 먼저 실행하세요.");
  process.exit(1);
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const d = (offset) => {
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + offset);
  return t.toISOString().slice(0, 10);
};
const at = (dayOffset, hhmm) => `${d(dayOffset)}T${hhmm}:00+09:00`;

// ── 업무 (proposed 없음 — 홈·캘린더 노출 규칙 준수. 에이전트 기원 1건은 승인된 todo) ──
async function task(projectId, title, status, assignee, dueOffset, priority = "mid", origin = "human", createdDaysAgo = 10, completedDaysAgo = null, areaName = "플랫폼", workType = "team") {
  const r = await q(
    `INSERT INTO task (project_id, area_id, work_type, title, status, assignee_id, due_date, priority, origin, created_by, created_at, completed_at, is_demo)
     VALUES ($1,(SELECT id FROM area WHERE name=$2),$3,$4,$5,$6,$7,$8,$9,$10, now() - ($11 || ' days')::interval,
             CASE WHEN $12::int IS NULL THEN NULL ELSE now() - ($12 || ' days')::interval END, true)
     RETURNING id`,
    [projectId, areaName, workType, title, status, assignee, dueOffset === null ? null : d(dueOffset), priority, origin, assignee, createdDaysAgo, completedDaysAgo]
  );
  return r.rows[0].id;
}

const tPoc = await task(edu, "PoC 결과 리포트 작성 및 배포", "doing", kwon, -2, "high");
const tCore = await task(play, "core 패키지 인터페이스 계약 확정", "doing", kwon, 1, "high");
const tPrd = await task(edu, "팀보드 PRD", "doing", kwon, 5);
const tLoad = await task(play, "Playino 로딩안", "todo", kwon, 9);
const tCurr = await task(edu, "커리큘럼 검수", "todo", kwon, 12);
const tHome = await task(play, "홈 대시보드 컴포넌트 1차", "review", jo, 2, "high");
const tEddie = await task(play, "EDDIE 모션 시트 스프라이트 정리", "doing", jo, 6);
const tEval = await task(train, "6~7장 수행평가 문항 초안", "doing", park, 4);
const tDb = await task(train, "차시 DB 스키마", "todo", park, 10);
const tAx = await task(edu, "AX3000SE WAN 모드 현장 검증", "todo", park, 5, "mid", "agent");
// 완료 이력 (이번 주 완료·스파크라인·목표 진척용)
const tDone1 = await task(edu, "PoC 현장 테스트 준비", "done", kwon, -3, "mid", "human", 12, 2);
const tDone2 = await task(train, "4~5장 평가문항 검수", "done", park, -1, "mid", "human", 9, 1);
const tDone3 = await task(play, "로그인 화면 시안", "done", jo, -2, "mid", "human", 8, 3);

// ── 영역 분류가 보이도록 프로젝트 없는 "영역 단위" 업무 (R&D·교육자료·디자인) + 상시업무 ──
const tRnd1 = await task(null, "AIoT 센서 모듈 R&D 리서치", "doing", kwon, 8, "mid", "human", 6, null, "R&D");
const tRnd2 = await task(null, "특허 선행조사", "todo", kwon, 14, "mid", "human", 4, null, "R&D");
const tEduA = await task(null, "8차시 교육자료 개정", "doing", park, 5, "mid", "human", 5, null, "교육자료");
const tDsn1 = await task(null, "쇼핑몰 상세페이지 디자인", "doing", jo, 3, "high", "human", 4, null, "디자인");
const tDsn2 = await task(null, "브랜드 배너 리뉴얼", "todo", jo, 9, "mid", "human", 3, null, "디자인");
// 상시업무 (work_type='routine') — 기한 없음, 마감·목표 집계 제외
await task(null, "주간 고객 문의 대응", "doing", park, null, "mid", "human", 20, null, "교육자료", "routine");
await task(null, "디자인 에셋 정리·백업", "doing", jo, null, "low", "human", 20, null, "디자인", "routine");

// ── 업무 기간(시작일) — 주·월 뷰 기간 바 확인용. 운영 시드는 건드리지 않음 (데모 전용). ──
const taskStarts = [
  [tPoc, -5], [tCore, -1], [tPrd, 0], [tLoad, 3], [tCurr, 7],
  [tHome, -1], [tEddie, 1], [tEval, -2], [tDb, 4], [tAx, 0],
  [tRnd1, -1], [tEduA, 0], [tDsn1, -2], [tDsn2, 4],
];
for (const [id, off] of taskStarts) {
  await q("UPDATE task SET start_date = $1 WHERE id = $2", [d(off), id]);
}

// ── 업무 설명(마크다운) — 상세 패널 "설명" 영역 확인용 (파트 5 보강) ──
const descriptions = [
  [tPoc, "## 목표\nPoC 결과를 리포트로 정리해 내부 공유 + 전북교육청 회신.\n\n## 체크리스트\n- [x] 로그 수집\n- [ ] 지표 표 작성\n- [ ] 배포(Notion)"],
  [tCore, "core 패키지 공개 인터페이스를 확정한다. 동적 로딩 여부는 시그널 결정 대기 중."],
  [tPrd, "팀보드 PRD 초안. 홈·업무·시그널·목표 4개 축의 화면 흐름과 권한 규칙 포함."],
  [tHome, "홈 대시보드 컴포넌트 1차. 링 게이지·타임라인 밀도 재배분 반영 후 리뷰 요청."],
  [tRnd1, "AIoT 센서 모듈 후보 3종 비교(전류·정확도·단가). 선행조사와 병행."],
  [tEval, "6~7장 수행평가 문항 초안. 난이도 3단계 루브릭 공통안 적용 예정."],
];
for (const [id, body] of descriptions) {
  await q("UPDATE task SET description = $1 WHERE id = $2", [body, id]);
}

// ── 업무 코멘트 + 활동 로그(업무 귀속) — 상세 패널 코멘트·타임라인 확인용 (파트 5) ──
async function taskComment(taskId, author, body, daysAgo) {
  await q(
    `INSERT INTO task_comment (task_id, author_id, body, created_at)
     VALUES ($1,$2,$3, now() - ($4 || ' days')::interval)`,
    [taskId, author, body, daysAgo]
  );
}
async function taskLog(taskId, userId, message, level, daysAgo) {
  await q(
    `INSERT INTO activity_log (user_id, task_id, message, level, created_at)
     VALUES ($1,$2,$3,$4, now() - ($5 || ' days')::interval)`,
    [userId, taskId, message, level, daysAgo]
  );
}
// tPoc — 논의가 오간 업무
await taskLog(tPoc, kwon, "권정혁이(가) 업무 생성 — \"PoC 결과 리포트 작성 및 배포\"", "info", 10);
await taskLog(tPoc, kwon, "상태 변경 todo → doing", "info", 6);
await taskComment(tPoc, park, "현장 로그 CSV 공유드렸어요. 채널 확인 부탁해요.", 5);
await taskComment(tPoc, kwon, "지표 표는 내일 오전까지 채우겠습니다.", 4);
await taskComment(tPoc, jo, "리포트 표지 디자인 필요하면 말씀 주세요.", 3);
// tHome — 리뷰 대기 업무
await taskLog(tHome, jo, "조서연이(가) 업무 생성 — \"홈 대시보드 컴포넌트 1차\"", "info", 8);
await taskLog(tHome, jo, "상태 변경 doing → review", "success", 2);
await taskComment(tHome, kwon, "링 게이지 색이 배경에 묻히지 않는지만 확인해주세요.", 2);
await taskComment(tHome, jo, "명암 개편 반영해서 재배포했습니다. 재확인 부탁해요.", 1);
// tRnd1 — 영역(R&D) 업무
await taskComment(tRnd1, kwon, "센서 후보 3종 단가표 정리 중. 정확도 데이터는 park가 확인.", 2);

// ── 일정 (오늘) ──
async function event(projectId, title, startAt, endAt, isTeam, participants) {
  const r = await q(
    `INSERT INTO event (project_id, title, start_at, end_at, is_team, created_by, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6, true) RETURNING id`,
    [projectId, title, startAt, endAt, isTeam, kwon]
  );
  for (const p of participants) {
    await q("INSERT INTO event_participant (event_id, actor_id) VALUES ($1,$2)", [r.rows[0].id, p]);
  }
  return r.rows[0].id;
}
await event(null, "주간회의", at(0, "10:00"), at(0, "11:00"), true, [kwon, park, jo]);
await event(edu, "PoC 결과 리뷰", at(0, "16:00"), at(0, "18:00"), true, [kwon, park, jo]);
await event(edu, "외부 미팅 · 전북교육청", at(0, "14:00"), at(0, "16:00"), false, [kwon]);
await event(play, "디자인 싱크", at(0, "09:00"), at(0, "11:00"), false, [jo]);
await event(train, "차시 구조 리뷰", at(2, "14:00"), at(2, "15:00"), false, [park]);

// ── 목표 트리: 연간 > 분기 > 월 (롤업 검증용 계층 포함) ──
const monthStart = today.slice(0, 8) + "01";
const [yy, mm] = today.split("-").map(Number);
const monthEnd = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);

async function goal({ periodType, start, end, title, parentId = null, projectId = null, mode = "auto", progress = 0, links = [] }) {
  const r = await q(
    `INSERT INTO goal (parent_id, period_type, period_start, period_end, title, progress_mode, progress, owner_actor_id, project_id, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, true) RETURNING id`,
    [parentId, periodType, start, end, title, mode, progress, kwon, projectId]
  );
  for (const t of links) await q("INSERT INTO goal_task (goal_id, task_id) VALUES ($1,$2)", [r.rows[0].id, t]);
  return r.rows[0].id;
}

const gYear = await goal({
  periodType: "year", start: `${yy}-01-01`, end: `${yy}-12-31`,
  title: `${yy} 교육 플랫폼 사업 기반 확립`,
});
const quarter = Math.floor((mm - 1) / 3) + 1;
const qStartM = (quarter - 1) * 3 + 1;
const qEndM = qStartM + 2;
const qEndDay = new Date(Date.UTC(yy, qEndM, 0)).getUTCDate();
const gQuarter = await goal({
  periodType: "quarter",
  start: `${yy}-${String(qStartM).padStart(2, "0")}-01`,
  end: `${yy}-${String(qEndM).padStart(2, "0")}-${qEndDay}`,
  title: `Q${quarter} 제품 코어 확정`, parentId: gYear,
});
// 하위 0개 분기 — 진척 "-" 표시 검증용
const nq = quarter === 4 ? 1 : quarter + 1;
const nqStartM = (nq - 1) * 3 + 1;
const nqEndM = nqStartM + 2;
const nqYear = quarter === 4 ? yy + 1 : yy;
await goal({
  periodType: "quarter",
  start: `${nqYear}-${String(nqStartM).padStart(2, "0")}-01`,
  end: `${nqYear}-${String(nqEndM).padStart(2, "0")}-${new Date(Date.UTC(nqYear, nqEndM, 0)).getUTCDate()}`,
  title: `Q${nq} 현장 적용 확대 (계획)`, parentId: quarter === 4 ? null : gYear,
});

await goal({ periodType: "month", start: monthStart, end: monthEnd, title: "EDUINO AI 커리큘럼 1차 완성", parentId: gQuarter, projectId: edu, links: [tPoc, tPrd, tCurr, tAx, tDone1] });
await goal({ periodType: "month", start: monthStart, end: monthEnd, title: "Playino 엔진 코어 계약 확정", parentId: gQuarter, projectId: play, links: [tCore, tHome, tEddie, tLoad, tDone3] });
await goal({ periodType: "month", start: monthStart, end: monthEnd, title: "AI 트레이너 차시 설계", parentId: gQuarter, projectId: train, links: [tEval, tDb, tDone2] });
// 수동 진척 목표 — Task 완료율에 영향받지 않아야 함 (검수 포인트 3)
await goal({ periodType: "month", start: monthStart, end: monthEnd, title: "키트 판매 200대", parentId: gQuarter, projectId: edu, mode: "manual", progress: 35, links: [tDone1] });

// ── 시그널 ──
async function signal(type, scope, title, body, author, status, daysAgo, projectId = null, taskId = null) {
  const r = await q(
    `INSERT INTO signal (type, scope, title, body, author_id, project_id, task_id, status, created_at, updated_at, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 || ' days')::interval, now(), true)
     RETURNING id`,
    [type, scope, title, body, author, projectId, taskId, status, daysAgo]
  );
  return r.rows[0].id;
}
const sDecision = await signal(
  "decision", "team",
  "Playino 빌드 통합 vs 동적 로딩 방식 확정",
  "엔진 배포 방식을 확정해야 core 계약을 마감할 수 있습니다.",
  kwon, "discussing", 34, play, tCore
);
await signal(
  "risk", "team",
  "ESP32-CAM LEDC 채널 충돌 — 카메라 XCLK와 모터 PWM",
  "동일 타이머 채널 사용 시 카메라 초기화가 실패합니다.",
  kwon, "open", 0, edu
);
await signal(
  "review", "team",
  "AX3000SE WAN 모드 검증 결과 확인 요청",
  "현장 검증 결과 회신 부탁드립니다.",
  kwon, "open", 2, edu, tAx
);
await signal(
  "memo", "private",
  "GPIO12 스트래핑 핀 부팅 실패 재현 조건",
  "부팅 시 HIGH로 풀리면 flash 전압 오설정. 재현 조건 기록.",
  kwon, "open", 4, edu
);
const hud1 = await signal(
  "memo", "huddle",
  "카메라 게임 4종 중 첫 에피소드 선정 기준",
  "교실 조명 편차를 감안하면 HSV 색상 미션이 가장 안정적입니다. ArUco는 인쇄 품질에 좌우돼 후순위가 맞을 듯.",
  kwon, "discussing", 3, play
);
const hud2 = await signal(
  "memo", "huddle",
  "차시별 평가문항 난이도 기준 정리 필요",
  "4~9장 수행평가 루브릭이 장마다 달라 교사가 헷갈릴 것 같아요. 공통 3단계로 맞추면 어떨까요.",
  park, "discussing", 1, train
);
// 해결된 결정 (평균 결정 소요 지표용)
const resolved1 = await signal("decision", "team", "키트 v2 부트로더 고정 버전 채택", "", kwon, "resolved", 20, edu);
await q("UPDATE signal SET resolved_at = now() - interval '13 days' WHERE id = $1", [resolved1]);
const resolved2 = await signal("decision", "team", "차시 콘텐츠 저장 포맷 JSON 확정", "", park, "resolved", 9, train);
await q("UPDATE signal SET resolved_at = now() - interval '5 days' WHERE id = $1", [resolved2]);

// ── 코멘트 ──
async function comment(signalId, author, body, daysAgo) {
  await q(
    `INSERT INTO comment (signal_id, author_id, body, created_at)
     VALUES ($1,$2,$3, now() - ($4 || ' days')::interval)`,
    [signalId, author, body, daysAgo]
  );
}
for (let i = 0; i < 6; i++) await comment(sDecision, [kwon, park, jo][i % 3], `논의 코멘트 ${i + 1}`, 30 - i * 4);
for (let i = 0; i < 4; i++) await comment(hud1, [park, jo, kwon, jo][i], `허들 코멘트 ${i + 1}`, 2);
for (let i = 0; i < 2; i++) await comment(hud2, [kwon, jo][i], `허들 코멘트 ${i + 1}`, 1);

// ── 에이전트 승인 대기 초안 1건 (시그널 패널의 에이전트 생성물 표시 검증) ──
const parkAgent = await agentOf(park);
await q(
  `INSERT INTO drafts (assistant_id, user_id, task_type, instruction, title, body, status, is_demo)
   VALUES ($1,$2,'자료조사','PoC 로그 분석','PoC 로그에서 검증 태스크 3건 추출','## 요약\n- 데모','pending', true)`,
  [parkAgent, park]
);

await q("INSERT INTO config (key, value) VALUES ('demo_seeded', 'true')");
console.log("데모 시드 완료 — 업무 13 · 일정 5 · 목표 3 · 시그널 8 · 시그널코멘트 12 · 업무설명 6 · 업무코멘트 6 · 승인 대기 초안 1");
await pool.end();

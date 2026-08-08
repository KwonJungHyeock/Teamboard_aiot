// DB 초기화 + 시드 (SPEC 5장 신규 스키마 기준). 사용법: DATABASE_URL=... npm run db:init
// 여러 번 실행해도 안전 (upsert). 구 스키마(users/assistants/app_settings) 발견 시
// 1회에 한해 드롭 후 재생성 (SPEC 5.1: 실데이터 없는 지금이 마이그레이션 최저 비용 — D-017).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("init-db.mjs");

const here = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || "teamboard123!";

const TEAM = [
  {
    email: "kwonjunghyeock@robodyne.co.kr",
    name: "권정혁",
    shortName: "정혁",
    role: "lead",
    notionUserId: "3ba23515-d244-458a-a0f7-a92cfadf950a",
    assistantName: "정혁의 에이전트",
    workAreas: ["R&D"],
    actorAreas: ["R&D", "플랫폼"], // 담당자 기본 영역 (첫 항목이 폼 기본값)
  },
  {
    email: "meotto@robodyne.co.kr",
    name: "박주희",
    shortName: "주희",
    role: "member",
    notionUserId: "260d872b-594c-81e4-9f78-000299e7e74b",
    assistantName: "주희의 에이전트",
    workAreas: ["연구소"],
    actorAreas: ["플랫폼", "연구소"],
  },
  {
    email: "sycho09@robodyne.co.kr",
    name: "조서연",
    shortName: "서연",
    role: "member",
    notionUserId: "5453c24d-940e-4cdf-9f89-1adfe5cc18ab",
    assistantName: "서연의 에이전트",
    workAreas: ["디자인"],
    actorAreas: ["디자인", "플랫폼"],
  },
  // 기획자용 관리자 계정 (자동 로그인 링크로 접속). 비밀번호는 나중에 교체 예정.
  {
    email: "robodynesystems",
    name: "ROBODYNE 관리자",
    shortName: "관리자",
    role: "lead",
    notionUserId: null,
    password: "robodyne",
    assistantName: "관리자의 에이전트",
    workAreas: ["R&D"],
    actorAreas: ["플랫폼", "R&D"],
  },
];

// 프로젝트 3종 — 모두 area=플랫폼. "AI 트레이너"는 "AI 학습추론모델"로 개명.
const PROJECTS = [
  { name: "EDUINO AI", colorKey: "edu", area: "플랫폼" },
  { name: "Playino", colorKey: "play", area: "플랫폼" },
  { name: "AI 학습추론모델", colorKey: "train", area: "플랫폼" },
];

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ── 구 스키마 정리 (1회) ──
const legacy = await pool.query("SELECT to_regclass('public.users') AS t");
if (legacy.rows[0].t) {
  console.log("구 스키마 감지 → 드롭 후 재생성 (실데이터 없음 전제, D-017)");
  await pool.query(
    "DROP TABLE IF EXISTS drafts, activity_log, users, assistants, app_settings CASCADE"
  );
}

// ── 스키마 적용 ──
const schema = readFileSync(join(here, "..", "db", "schema.sql"), "utf8");
await pool.query(schema);
console.log("스키마 적용 완료");

// ── 팀원(human actor + account) + 에이전트(agent actor + agent_config) ──
for (const member of TEAM) {
  // 사람은 display_name으로 식별(안정 키). 이렇게 하면 이메일이 바뀌어도
  // 기존 사람의 email을 갱신할 뿐 계정을 중복 생성하지 않는다.
  const existing = await pool.query(
    "SELECT id FROM actor WHERE type = 'human' AND display_name = $1 ORDER BY id LIMIT 1",
    [member.name]
  );

  let humanId;
  if (existing.rows.length > 0) {
    humanId = existing.rows[0].id;
    await pool.query(
      "UPDATE actor SET short_name = $1, is_active = true WHERE id = $2",
      [member.shortName ?? null, humanId]
    );
    // email 포함 갱신 (email 변경 시 여기서 반영). password_hash는 기존 유지.
    await pool.query(
      "UPDATE account SET email = $1, role = $2, notion_user_id = $3 WHERE actor_id = $4",
      [member.email, member.role, member.notionUserId, humanId]
    );
  } else {
    const inserted = await pool.query(
      "INSERT INTO actor (type, display_name, short_name) VALUES ('human', $1, $2) RETURNING id",
      [member.name, member.shortName ?? null]
    );
    humanId = inserted.rows[0].id;
    await pool.query(
      `INSERT INTO account (actor_id, email, password_hash, role, notion_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [humanId, member.email, hashPassword(member.password ?? DEFAULT_PASSWORD), member.role, member.notionUserId]
    );
  }

  // 에이전트: owner 기준 1개 보장
  const agent = await pool.query(
    "SELECT id FROM actor WHERE type = 'agent' AND owner_actor_id = $1",
    [humanId]
  );
  let agentId;
  if (agent.rows.length > 0) {
    agentId = agent.rows[0].id;
  } else {
    const inserted = await pool.query(
      "INSERT INTO actor (type, display_name, owner_actor_id) VALUES ('agent', $1, $2) RETURNING id",
      [member.assistantName, humanId]
    );
    agentId = inserted.rows[0].id;
    await pool.query(
      "INSERT INTO agent_config (actor_id, work_areas) VALUES ($1, $2)",
      [agentId, JSON.stringify(member.workAreas)]
    );
  }
  // 담당자 기본 영역(actor_area) — 이름으로 area 조회해 매핑
  for (let i = 0; i < (member.actorAreas ?? []).length; i++) {
    await pool.query(
      `INSERT INTO actor_area (actor_id, area_id, sort_order)
       SELECT $1, a.id, $3 FROM area a WHERE a.name = $2
       ON CONFLICT (actor_id, area_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
      [humanId, member.actorAreas[i], i]
    );
  }
  console.log(`시드: ${member.name} (${member.email}) / 역할=${member.role} / 에이전트 actor#${agentId}`);
}

// ── 프로젝트 3종 (area=플랫폼) — 구명 "AI 트레이너" 개명 반영 ──
await pool.query("UPDATE project SET name = 'AI 학습추론모델' WHERE name = 'AI 트레이너'");
for (const project of PROJECTS) {
  await pool.query(
    `INSERT INTO project (name, color_key, area_id)
     SELECT $1, $2, (SELECT id FROM area WHERE name = $3)
     WHERE NOT EXISTS (SELECT 1 FROM project WHERE name = $1)`,
    [project.name, project.colorKey, project.area]
  );
  // 기존 프로젝트도 영역 보정
  await pool.query(
    "UPDATE project SET area_id = (SELECT id FROM area WHERE name = $2) WHERE name = $1",
    [project.name, project.area]
  );
}
console.log("프로젝트 시드: " + PROJECTS.map((p) => p.name).join(" / "));

// ── config 기본값 ──
await pool.query(
  `INSERT INTO config (key, value) VALUES ('notion_scope', $1)
   ON CONFLICT (key) DO NOTHING`,
  [
    JSON.stringify({
      dataSourceId: process.env.NOTION_TIMELINE_DS_ID || "531bfb36-5fc4-4736-874d-8e8fa3124ed3",
      label: "🗓️ 팀 업무 타임라인",
    }),
  ]
);
// 시그널 정체 임계값 (SPEC 2.3 — 코드 배포 없이 조정 가능해야 함)
await pool.query(
  `INSERT INTO config (key, value) VALUES ('signal_thresholds', $1)
   ON CONFLICT (key) DO NOTHING`,
  [JSON.stringify({ decision: 14, review: 7, memo: null, risk: 0 })]
);
// 미실행 결정(decided) 정체 임계값 — decided 상태가 이 일수 이상 지속되면 상단 노출
await pool.query(
  `INSERT INTO config (key, value) VALUES ('signal_decided_stale_days', $1)
   ON CONFLICT (key) DO NOTHING`,
  [JSON.stringify(7)]
);
console.log("config 시드: notion_scope, signal_thresholds, signal_decided_stale_days");

console.log(`완료. 초기 비밀번호: ${DEFAULT_PASSWORD}`);
await pool.end();

// DB 초기화 + 시드 (SPEC 5장 신규 스키마 기준). 사용법: DATABASE_URL=... npm run db:init
// 여러 번 실행해도 안전 (upsert). 구 스키마(users/assistants/app_settings) 발견 시
// 1회에 한해 드롭 후 재생성 (SPEC 5.1: 실데이터 없는 지금이 마이그레이션 최저 비용 — D-017).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || "teamboard123!";

const TEAM = [
  {
    email: "jhkwon@robodyne.co.kr",
    name: "권정혁",
    shortName: "정혁",
    role: "lead",
    notionUserId: "3ba23515-d244-458a-a0f7-a92cfadf950a",
    assistantName: "정혁의 부사수",
    workAreas: ["R&D"],
  },
  {
    email: "jhpark@robodyne.co.kr",
    name: "박주희",
    shortName: "주희",
    role: "member",
    notionUserId: "260d872b-594c-81e4-9f78-000299e7e74b",
    assistantName: "주희의 부사수",
    workAreas: ["교육자료"],
  },
  {
    email: "syjo@robodyne.co.kr",
    name: "조서연",
    shortName: "서연",
    role: "member",
    notionUserId: "5453c24d-940e-4cdf-9f89-1adfe5cc18ab",
    assistantName: "서연의 부사수",
    workAreas: ["디자인"],
  },
];

// 프로젝트 3종 (CHANGE-GUIDE Phase 1) — color_key는 theme.css 토큰 키
const PROJECTS = [
  { name: "EDUINO AI", colorKey: "edu" },
  { name: "Playino", colorKey: "play" },
  { name: "AI 트레이너", colorKey: "train" },
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

// ── 팀원(human actor + account) + 부사수(agent actor + agent_config) ──
for (const member of TEAM) {
  // 이메일로 기존 계정 탐색 → 있으면 갱신, 없으면 actor부터 생성
  const existing = await pool.query("SELECT actor_id FROM account WHERE email = $1", [
    member.email,
  ]);

  let humanId;
  if (existing.rows.length > 0) {
    humanId = existing.rows[0].actor_id;
    await pool.query(
      "UPDATE actor SET display_name = $1, short_name = $2, is_active = true WHERE id = $3",
      [member.name, member.shortName ?? null, humanId]
    );
    await pool.query(
      "UPDATE account SET role = $1, notion_user_id = $2 WHERE actor_id = $3",
      [member.role, member.notionUserId, humanId]
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
      [humanId, member.email, hashPassword(DEFAULT_PASSWORD), member.role, member.notionUserId]
    );
  }

  // 부사수: owner 기준 1개 보장
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
  console.log(`시드: ${member.name} (${member.email}) / 역할=${member.role} / 부사수 actor#${agentId}`);
}

// ── 프로젝트 3종 ──
for (const project of PROJECTS) {
  await pool.query(
    `INSERT INTO project (name, color_key)
     SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM project WHERE name = $1)`,
    [project.name, project.colorKey]
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
console.log("config 시드: notion_scope, signal_thresholds");

console.log(`완료. 초기 비밀번호: ${DEFAULT_PASSWORD}`);
await pool.end();

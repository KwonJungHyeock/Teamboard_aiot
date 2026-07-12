// DB 초기화 + 팀원 시드. 사용법: DATABASE_URL=... npm run db:init
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

// PRD 9장: 담당자 Notion person ID
const TEAM = [
  {
    email: "jhkwon@robodyne.co.kr",
    name: "권정혁",
    role: "lead",
    notionUserId: "3ba23515-d244-458a-a0f7-a92cfadf950a",
    assistantName: "정혁의 부사수",
    workAreas: ["R&D"],
  },
  {
    email: "jhpark@robodyne.co.kr",
    name: "박주희",
    role: "member",
    notionUserId: "260d872b-594c-81e4-9f78-000299e7e74b",
    assistantName: "주희의 부사수",
    workAreas: ["교육자료"],
  },
  {
    email: "syjo@robodyne.co.kr",
    name: "조서연",
    role: "member",
    notionUserId: "5453c24d-940e-4cdf-9f89-1adfe5cc18ab",
    assistantName: "서연의 부사수",
    workAreas: ["디자인"],
  },
];

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

const schema = readFileSync(join(here, "..", "db", "schema.sql"), "utf8");
await pool.query(schema);
console.log("스키마 적용 완료");

for (const member of TEAM) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, notion_user_id, password_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
       notion_user_id = EXCLUDED.notion_user_id
     RETURNING id`,
    [member.email, member.name, member.role, member.notionUserId, hashPassword(DEFAULT_PASSWORD)]
  );
  const userId = rows[0].id;
  await pool.query(
    `INSERT INTO assistants (user_id, name, work_areas)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, member.assistantName, JSON.stringify(member.workAreas)]
  );
  console.log(`시드: ${member.name} (${member.email}) / 역할=${member.role}`);
}

await pool.query(
  `INSERT INTO app_settings (key, value)
   VALUES ('notion_scope', $1)
   ON CONFLICT (key) DO NOTHING`,
  [
    JSON.stringify({
      dataSourceId: process.env.NOTION_TIMELINE_DS_ID || "531bfb36-5fc4-4736-874d-8e8fa3124ed3",
      label: "🗓️ 팀 업무 타임라인",
    }),
  ]
);

console.log(`완료. 초기 비밀번호: ${DEFAULT_PASSWORD}`);
await pool.end();

// 로그인 → 홈 진입 스모크 (MD-P-2026-015 §D · MD-P-008 D-4)
//
// 이 테스트는 "배포가 살아있는가"만 본다. 화면 내용을 세세히 검증하지 않는다 —
// 그건 화면별 점검(MD-P-2026-013)의 몫이고, 여기서 하면 데이터가 바뀔 때마다 깨진다.
//
// 계정은 테스트가 직접 만들고 끝나면 지운다. 시드 비밀번호에 기대지 않는다
// (운영에서 이미 바뀌어 있을 수 있고, CI가 남의 계정으로 로그인해서도 안 된다).
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomBytes, scryptSync } from "node:crypto";

const EMAIL = `e2e-smoke-${process.pid}@example.invalid`;
const PASSWORD = "E2eSmoke!2026";
const NAME = "e2e 스모크";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

// init-db 와 같은 방식 (scrypt, "salt:hash")
function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

let actorId: number;

/** 로그인 — 여러 테스트가 같은 절차를 쓰므로 한 곳에 모은다. */
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click("form button");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.beforeAll(async () => {
  const a = await pool.query<{ id: number }>(
    `INSERT INTO actor (display_name, type, short_name) VALUES ($1, 'human', 'e2e') RETURNING id`,
    [NAME]
  );
  actorId = a.rows[0].id;
  await pool.query(
    `INSERT INTO account (actor_id, email, password_hash, role) VALUES ($1, $2, $3, 'member')`,
    [actorId, EMAIL, hashPassword(PASSWORD)]
  );
});

test.afterAll(async () => {
  if (actorId) {
    await pool.query(`DELETE FROM activity_log WHERE user_id = $1`, [actorId]);
    await pool.query(`DELETE FROM account WHERE actor_id = $1`, [actorId]);
    await pool.query(`DELETE FROM actor WHERE id = $1`, [actorId]);
  }
  await pool.end();
});

test("비로그인은 로그인 화면으로 보낸다", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("로그인 → 홈 진입", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await login(page);

  // 홈이 실제로 그려지는지 — 사이드바가 뜨면 셸이 살아있는 것
  await page.goto("/");
  await expect(page.locator(".side, aside")).toBeVisible();
  expect(errors, `런타임 에러: ${errors.join(" | ")}`).toHaveLength(0);
});

test("첫 로그인 계정에는 첫 사용 안내가 뜬다", async ({ page }) => {
  await login(page);

  await page.goto("/");
  await expect(page.locator(".frn")).toBeVisible();
  await page.click(".frn-skip");
  await expect(page.locator(".frn")).toHaveCount(0);

  // 건너뛰면 다시 뜨지 않는다
  await page.reload();
  await expect(page.locator(".frn")).toHaveCount(0);
});

test("member 는 관리 화면에 들어갈 수 없다", async ({ page }) => {
  await login(page);

  for (const path of ["/members", "/settings", "/status"]) {
    await page.goto(path);
    await expect(page, `${path} 가 열렸다`).not.toHaveURL(new RegExp(`${path}$`));
  }
});

test("없는 주소는 404 화면을 준다", async ({ page }) => {
  // 인증 게이트가 먼저 걸리므로 로그인한 뒤에 확인한다
  // (비로그인으로 없는 주소를 치면 /login 으로 보내는 게 맞는 동작이다).
  await login(page);
  await page.goto("/이런주소는없습니다-e2e");
  await expect(page.locator(".errpage-code")).toHaveText("404");
  await expect(page.locator('.errpage-act a[href="/"]')).toBeVisible();
});

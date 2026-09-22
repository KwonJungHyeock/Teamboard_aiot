// 검사가 쓰는 신분 — **DB 에서 읽는다** (MD-P-2026-065 §B-9).
//
// ── 왜 ───────────────────────────────────────────────────────────
//
// 검사기 스물둘이 쿠키를 손으로 적고 있었다:
//
//     tok({ id: 1, actorId: 1, name: "권정혁", role: "lead", email: "l@l" })
//
// 063 §B-1 에서 actor 1 의 역할이 `admin` 으로 바로잡히자 **쿠키가 DB 와 다른
// 역할을 말하게 됐다.** 지금은 둘 다 관리자로 판정돼(`isAdmin` = role='admin'
// 또는 admin_grant) 티가 안 나지만, 이름표를 읽는 검사가 하나만 생겨도 거기서
// 어긋난다 — 064 §B-1 의 `②-이름표-팀장` 이 정확히 그런 줄이었다.
//
// **손으로 적는 한 또 어긋난다.** 값을 만든 쪽(DB)에서 가져온다(§G 048).
//
// ── 065 §B-7 에서 먼저 잰 것 ────────────────────────────────────
//
// 고치기 전에, 쿠키를 `admin` 으로 바꿔 검사기 열여섯을 돌려 봤다.
// **결과가 달라지는 것은 0개**였다(빨간 셋도 전과 같은 셋). 그래서 이 변경은
// 「틀린 것을 재고 있던 검사기를 고치는 일」이 아니라 **정리**다.
// 달라지는 것이 있었으면 거기서 멈추고 보고했을 것이다(§B-8).
//
// ── 쓰는 법 ─────────────────────────────────────────────────────
//
//     import { testUser } from "./test-user.mjs";
//     const ME = await testUser();          // 관리자 한 사람
//     const ME = await testUser("member");  // 팀원 한 사람
//     ... tok(ME) ...
//
// 이름·역할·권한이 **전부 DB 값**이다. 검사용 사람을 바꿀 일이 생기면
// DB 를 바꾸면 되고, 이 파일도 부르는 쪽도 안 고친다.
import pg from "pg";

/**
 * 어떤 사람을 고르는가. **이름으로 고르지 않는다**(§G) — 역할과 권한으로 고른다.
 *   admin   관리 화면에 들어갈 수 있는 사람 (role='admin' 또는 admin_grant)
 *   lead    역할이 정확히 `lead` 인 사람
 *   member  역할이 `member` 이고 관리자 권한이 없는 사람
 */
const WHERE = {
  admin:  `(a.role = 'admin' OR a.admin_grant = true)`,
  lead:   `a.role = 'lead'`,
  member: `a.role = 'member' AND NOT a.admin_grant`,
};

/**
 * 검사용 세션 몸통을 돌려준다. 쿠키에 들어가는 `role` 이 **DB 의 role 과 같다.**
 *
 * @param {"admin"|"lead"|"member"} kind
 * @returns {Promise<{id:number, actorId:number, name:string, role:string, adminGrant:boolean, email:string}>}
 */
export async function testUser(kind = "admin") {
  const where = WHERE[kind];
  if (!where) throw new Error(`testUser: 모르는 갈래 "${kind}" (admin·lead·member 중 하나)`);
  // 화면만 보던 검사기도 이제 DB 를 탄다. 없으면 **pg 의 알 수 없는 오류** 대신
  // 무엇이 없는지로 죽는다 — 원인을 못 읽는 실패는 실패를 두 번 하게 만든다.
  if (!process.env.DATABASE_URL) throw new Error("testUser: DATABASE_URL 이 필요하다");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT a.actor_id id, a.role, a.admin_grant, a.email, ac.display_name name
         FROM account a JOIN actor ac ON ac.id = a.actor_id
        WHERE ac.is_active AND ${where}
        ORDER BY a.actor_id LIMIT 1`);
    const r = rows[0];
    // **없으면 조용히 넘어가지 않는다.** 없는 신분으로 만든 쿠키는 검사 전체를
    // 뜻 없게 만든다 — 그때는 「조건을 못 만들었다」가 맞는 답이다(§G 051).
    if (!r) throw new Error(`testUser: "${kind}" 에 맞는 활성 계정이 DB 에 없다`);
    return { id: r.id, actorId: r.id, name: r.name, role: r.role,
             adminGrant: r.admin_grant === true, email: r.email };
  } finally {
    await pool.end();
  }
}

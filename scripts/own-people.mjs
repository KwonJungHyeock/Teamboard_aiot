// 검사가 쓰는 **제 사람** — 만들고, 쓰고, 지운다 (MD-P-2026-076 §A).
//
// 권한 · 역할을 재는 검사기가 **사람 계정**의 역할과 권한을 바꿨다 넣었다(073 §B 의 중간 둘).
// 권한이 잘못 남으면 사람이 못 들어오거나 안 되는 것이 된다. 그래서 역할 · 권한을 바꿔 봐야
// 하는 자리에는 **이번 판에 만든 계정**만 쓴다.
//
//   const own = ownPeople(pool, "[039검사]");
//   const L1 = await own.make({ role: "lead", grant: false, label: "팀장1" });   // 쿠키 몸통을 돌려준다
//   …
//   await own.dropAll();          // finally 에서 — 만든 계정과 그 계정이 남긴 기록만 지운다
//
// 이름은 표식으로 시작하고, 메일은 `zz-own-<표식숫자>-<n>@example.com` 이다. 지울 때는 **이 판에
// 만든 id** 로만 지운다 — 이름이 같다고 지우지 않는다(074 §G · 못 고르면 안 지운다).
export function ownPeople(pool, mark) {
  const ids = [];
  const tag = String(mark).replace(/\D/g, "") || "x";
  return {
    ids,
    /** 활성 사람 계정 하나. 돌려주는 것은 로그인 쿠키에 넣을 몸통(역할 · 권한이 DB 와 같다) */
    async make({ role = "member", grant = false, label = "사람" } = {}) {
      const name = `${mark} ${label}`;
      const actor = (await pool.query(
        `INSERT INTO actor (type, display_name, is_active) VALUES ('human', $1, true) RETURNING id`, [name])).rows[0].id;
      const email = `zz-own-${tag}-${actor}@example.com`;
      await pool.query(
        `INSERT INTO account (actor_id, email, password_hash, role, admin_grant, onboarded_at)
         VALUES ($1, $2, 'x', $3, $4, now())`, [actor, email, role, grant]);
      ids.push(actor);
      return { id: actor, actorId: actor, name, role, adminGrant: grant, email };
    },
    /** 만든 계정 · 그 계정이 남긴 활동 기록 · 알림 · 소속을 지운다. 지운 계정 수를 돌려준다 */
    async dropAll() {
      if (!ids.length) return 0;
      await pool.query(`DELETE FROM activity_log WHERE user_id = ANY($1::int[])`, [ids]).catch(() => {});
      await pool.query(`DELETE FROM notification WHERE user_id = ANY($1::int[]) OR actor_id = ANY($1::int[])`, [ids]).catch(() => {});
      await pool.query(`DELETE FROM actor_area WHERE actor_id = ANY($1::int[])`, [ids]).catch(() => {});
      await pool.query(`DELETE FROM account WHERE actor_id = ANY($1::int[])`, [ids]);
      const r = await pool.query(`DELETE FROM actor WHERE id = ANY($1::int[]) RETURNING id`, [ids]);
      return r.rowCount;
    },
  };
}

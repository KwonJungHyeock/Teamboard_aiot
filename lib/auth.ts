// 세션/인증 — 메일플러그 SSO 방식 확정 전까지 이메일+비밀번호 (PRD 16장 열린 질문).
// 세션은 HMAC 서명 쿠키. 비밀키는 AUTH_SECRET.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { queryOne, queryUnmigrated } from "./db";
import { hasLead, isAdmin, type Role, type SessionUser } from "./types";

export const SESSION_COOKIE = "tb_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7일

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET 환경변수가 설정되지 않았습니다.");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * `account.admin_grant` 를 **컬럼이 아직 없어도 던지지 않게** 읽는다 (039 §A).
 *
 * 0031 때 마이그레이션 하나가 실패하자 팀 전원이 로그인조차 못 했다. 그래서
 * 로그인·라이브 세션 조회에 §5 예외를 뒀다(`queryUnmigrated`). 그런데 그 조회에
 * `ac.admin_grant` 를 그냥 적으면 **0034 가 안 끝난 순간 로그인이 다시 죽는다** —
 * 예외를 뚫어 놓고 그 옆에 같은 구멍을 내는 셈이다.
 *
 * `to_jsonb(행) ->> '이름'` 은 그 키가 없으면 NULL 을 낸다. 던지지 않는다.
 * 컬럼이 없다 → NULL → **권한 없음**으로 읽힌다. 없는 값을 권한 있음으로
 * 읽는 쪽이 훨씬 나쁘므로 이 방향이 맞다.
 *
 * `scripts/repro-0034.mjs` 가 이 문자열을 **여기서 읽어다** 컬럼 없는 상태에
 * 대고 돌린다 — 검사기가 사본을 들면 사본만 맞고 제품은 틀릴 수 있다.
 */
// 052 §A 에서 「팀 현황」도 이 칸을 읽는다. 사본을 뜨면 한쪽만 고쳐져서
// 0034 안 된 환경에서 그 화면만 500 이 난다 — 그래서 내보낸다.
// 별칭은 `ac` = account 다(여기 쿼리들과 같게 맞춰 쓸 것).
export const ADMIN_GRANT_SQL = `(to_jsonb(ac) ->> 'admin_grant')::boolean AS admin_grant`;

export function createSessionToken(user: SessionUser): string {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string): SessionUser | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      id: data.id, email: data.email, name: data.name, role: data.role as Role,
      // 039 이전에 발급된 쿠키에는 이 칸이 없다. **없으면 권한 없음이다.**
      adminGrant: data.adminGrant === true,
    };
  } catch {
    return null;
  }
}

export function getSession(): SessionUser | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * 라이브 세션 해석 (Phase 9) — 토큰 서명 검증 후 actor를 조회해 실시간 상태를 반영한다.
 * 한 번의 조회로 is_active·role·must_change_pw를 함께 가져와 추가 쿼리를 만들지 않는다.
 * 비활성 계정이면 세션을 무효(null)로 처리하고 activity_log(warn)에 기록한다.
 * 기존 sync 함수(getSession/requireSession/requireLead) 시그니처는 그대로 두고 이 함수만 추가한다.
 */
export interface LiveSession {
  user: SessionUser;
  mustChangePassword: boolean;
}

export async function getLiveSession(): Promise<LiveSession | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenUser = verifySessionToken(token);
  if (!tokenUser) return null;

  // 여기도 연다. 로그인만 되고 그다음 요청이 전부 막히면 로그인이 열린 값을 못 한다.
  const row = await queryUnmigrated<{
    is_active: boolean;
    display_name: string;
    role: Role;
    must_change_pw: boolean;
    admin_grant: boolean | null;
  }>(
    `SELECT a.is_active, a.display_name, ac.role, ac.must_change_pw, ${ADMIN_GRANT_SQL}
     FROM actor a JOIN account ac ON ac.actor_id = a.id
     WHERE a.id = $1 AND a.type = 'human'`,
    [tokenUser.id]
  );
  if (!row || !row.is_active) {
    // 순환 참조 방지를 위해 동적 import
    // 기록은 best-effort 다. 이 로그를 못 남긴다고 **차단을 못 하면 안 된다** —
    // 게다가 마이그레이션이 깨진 상태에서는 이 쓰기 자체가 던진다(B-29 §5).
    try {
      const { logActivity } = await import("./activity");
      await logActivity({
        userId: null,
        message: `비활성/삭제 계정 세션 접근 차단 — actor#${tokenUser.id} (${tokenUser.email})`,
        level: "warn",
      });
    } catch (err) {
      // **삼켜도 되는 이유** — 이 함수의 본 동작은 **차단**이고 그건 이미 끝났다
      // (아래 return null). 기록은 그 사실을 남기는 부수 작업이다.
      // 마이그레이션이 깨진 상태에서는 이 쓰기가 던지는데(B-29 §5), 그때
      // 차단까지 못 하면 비활성 계정이 되레 통과한다. 순서가 뒤집힌다.
      // 삼키되 **조용히는 아니다** — 빈 catch 는 다음 사람에게 이유를 안 남긴다.
      console.error(
        `[auth] 비활성 계정 차단은 했으나 기록에 실패 — actor#${tokenUser.id}: ` +
        (err instanceof Error ? err.message : String(err))
      );
    }
    return null;
  }
  // 실시간 role·admin_grant·must_change_pw 반영 (승격·강등·권한 회수 즉시 적용).
  // 권한을 회수하면 **다음 요청부터** 막힌다 — 쿠키가 만료될 때까지 기다리지 않는다.
  return {
    user: {
      id: tokenUser.id, email: tokenUser.email, name: row.display_name, role: row.role,
      adminGrant: row.admin_grant === true,
    },
    mustChangePassword: row.must_change_pw,
  };
}

/** 라이브 lead 검증 — 비활성/강등 즉시 반영. 민감 API(구성원 관리 등)에서 사용 */
export async function requireLiveLead(): Promise<SessionUser> {
  const live = await getLiveSession();
  if (!live) throw new AuthError(401, "세션이 만료되었거나 비활성화된 계정입니다.");
  if (!hasLead(live.user.role)) throw new AuthError(403, "팀장만 접근할 수 있습니다.");
  return live.user;
}

export function requireSession(): SessionUser {
  const session = getSession();
  if (!session) throw new AuthError(401, "로그인이 필요합니다.");
  return session;
}

export function requireLead(): SessionUser {
  const session = requireSession();
  if (!hasLead(session.role)) throw new AuthError(403, "팀장만 접근할 수 있습니다.");
  return session;
}

/**
 * **관리자 전용.** `hasLead` 와 달리 팀장은 통과하지 못한다.
 *
 * 거는 곳은 세 자리뿐이다 — 멤버 관리 화면 · 역할 변경 · 계정 발급
 * (MD-P-2026-035 §B-3). 마이그레이션 **조회**에는 걸지 않는다:
 * §5 예외로 팀장까지 열어 둔다. 마이그레이션이 깨졌을 때 원인을 볼 수 있는
 * 사람을 줄이면, 고칠 방법이 사라진다.
 *
 * ⚠ 이건 **쿠키를 보는** 게이트다. 권한을 회수해도 그 쿠키가 새로 발급될
 *   때까지는 통과한다. 관리자 자리는 전부 아래 `requireLiveAdmin` 을 쓴다 —
 *   이 함수는 지금 부르는 곳이 없다. 지우지 않고 둔 이유는 `requireLead` 와
 *   짝을 이루는 자리이기 때문이고, 쓸 때는 이 성질을 알고 써야 한다.
 */
export function requireAdmin(): SessionUser {
  const session = requireSession();
  if (!isAdmin(session)) throw new AuthError(403, "관리자만 접근할 수 있습니다.");
  return session;
}

/** 실시간 역할로 확인하는 관리자 게이트 — 강등 즉시 반영(토큰이 아니라 DB 기준). */
export async function requireLiveAdmin(): Promise<SessionUser> {
  const live = await getLiveSession();
  if (!live) throw new AuthError(401, "세션이 만료되었거나 비활성화된 계정입니다.");
  if (!isAdmin(live.user)) throw new AuthError(403, "관리자만 접근할 수 있습니다.");
  return live.user;
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** scrypt 해시 생성 — "salt:hash" 형식 (init-db 시드와 동일 방식). Phase 8 계정 발급용 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/** 임시 비밀번호 생성 — 계정 발급 시 1회용 (사용자는 최초 로그인에 변경 강제) */
export function generateTempPassword(): string {
  return `Tb-${randomBytes(6).toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  // 신규 스키마: actor(type='human', is_active) + account 조인
  // `queryUnmigrated` — 마이그레이션이 깨져도 **로그인은 된다**(B-29 §5).
  // 0031 실패 때 팀 전원이 못 들어왔고 팀장도 원인을 볼 수 없었다. 손이 묶였다.
  const user = await queryUnmigrated<{
    id: number;
    email: string;
    name: string;
    role: Role;
    password_hash: string;
    admin_grant: boolean | null;
  }>(
    `SELECT a.id, ac.email, a.display_name AS name, ac.role, ac.password_hash, ${ADMIN_GRANT_SQL}
     FROM account ac JOIN actor a ON a.id = ac.actor_id
     WHERE ac.email = $1 AND a.is_active = true`,
    [email.trim().toLowerCase()]
  );
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  await queryUnmigrated("UPDATE account SET last_login_at = now() WHERE actor_id = $1", [user.id]);
  return {
    id: user.id, email: user.email, name: user.name, role: user.role,
    adminGrant: user.admin_grant === true,
  };
}

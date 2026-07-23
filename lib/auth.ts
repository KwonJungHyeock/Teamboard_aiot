// 세션/인증 — 메일플러그 SSO 방식 확정 전까지 이메일+비밀번호 (PRD 16장 열린 질문).
// 세션은 HMAC 서명 쿠키. 비밀키는 AUTH_SECRET.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { queryOne } from "./db";
import type { Role, SessionUser } from "./types";

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
    return { id: data.id, email: data.email, name: data.name, role: data.role as Role };
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

  const row = await queryOne<{
    is_active: boolean;
    display_name: string;
    role: Role;
    must_change_pw: boolean;
  }>(
    `SELECT a.is_active, a.display_name, ac.role, ac.must_change_pw
     FROM actor a JOIN account ac ON ac.actor_id = a.id
     WHERE a.id = $1 AND a.type = 'human'`,
    [tokenUser.id]
  );
  if (!row || !row.is_active) {
    // 순환 참조 방지를 위해 동적 import
    const { logActivity } = await import("./activity");
    await logActivity({
      userId: null,
      message: `비활성/삭제 계정 세션 접근 차단 — actor#${tokenUser.id} (${tokenUser.email})`,
      level: "warn",
    });
    return null;
  }
  // 실시간 role·must_change_pw 반영 (승격·강등·비번변경 즉시 적용)
  return {
    user: { id: tokenUser.id, email: tokenUser.email, name: row.display_name, role: row.role },
    mustChangePassword: row.must_change_pw,
  };
}

/** 라이브 lead 검증 — 비활성/강등 즉시 반영. 민감 API(구성원 관리 등)에서 사용 */
export async function requireLiveLead(): Promise<SessionUser> {
  const live = await getLiveSession();
  if (!live) throw new AuthError(401, "세션이 만료되었거나 비활성화된 계정입니다.");
  if (live.user.role !== "lead") throw new AuthError(403, "팀장만 접근할 수 있습니다.");
  return live.user;
}

export function requireSession(): SessionUser {
  const session = getSession();
  if (!session) throw new AuthError(401, "로그인이 필요합니다.");
  return session;
}

export function requireLead(): SessionUser {
  const session = requireSession();
  if (session.role !== "lead") throw new AuthError(403, "팀장만 접근할 수 있습니다.");
  return session;
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
  const user = await queryOne<{
    id: number;
    email: string;
    name: string;
    role: Role;
    password_hash: string;
  }>(
    `SELECT a.id, ac.email, a.display_name AS name, ac.role, ac.password_hash
     FROM account ac JOIN actor a ON a.id = ac.actor_id
     WHERE ac.email = $1 AND a.is_active = true`,
    [email.trim().toLowerCase()]
  );
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  await queryOne("UPDATE account SET last_login_at = now() WHERE actor_id = $1", [user.id]);
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

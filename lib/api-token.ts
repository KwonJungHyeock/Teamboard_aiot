// Claude 연결 키 — 서버 쪽 (0040_api_token.sql).
//
// 키는 `tbk_` + 무작위 32바이트. DB 에는 sha256 만 남는다(키는 만들 때 한 번만 보인다).
// 키로 들어온 요청은 **그 사람의 세션과 똑같이** 다룬다 — 권한 규칙을 새로 만들지 않는다.
import { createHash, randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { ADMIN_GRANT_SQL } from "./auth";
import type { Role, SessionUser } from "./types";

/** 한 사람이 동시에 살려 둘 수 있는 키 — 데스크톱 · Claude Code · 노트북 정도 */
export const MAX_LIVE_TOKENS = 5;

export class TokenError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

export interface TokenRow { id: number; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }

export async function listTokens(actorId: number): Promise<TokenRow[]> {
  const rows = await query<{ id: number; name: string; prefix: string; created_at: string; last_used_at: string | null }>(
    `SELECT id, name, prefix, created_at::text, last_used_at::text FROM api_token
      WHERE actor_id = $1 AND revoked_at IS NULL ORDER BY id DESC`, [actorId]);
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/** 새 키 — 돌려주는 `token` 은 **이번 한 번만** 있다 */
export async function createToken(actorId: number, rawName: unknown): Promise<{ id: number; token: string; prefix: string }> {
  const name = String(rawName ?? "").trim().slice(0, 60) || "Claude";
  const live = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM api_token WHERE actor_id = $1 AND revoked_at IS NULL`, [actorId]);
  if (Number(live?.n ?? 0) >= MAX_LIVE_TOKENS)
    throw new TokenError(`연결 키는 ${MAX_LIVE_TOKENS}개까지입니다. 안 쓰는 키를 끊고 다시 만드세요.`);
  const token = `tbk_${randomBytes(32).toString("base64url")}`;
  const prefix = token.slice(0, 10);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO api_token (actor_id, name, token_hash, prefix) VALUES ($1, $2, $3, $4) RETURNING id`,
    [actorId, name, hash(token), prefix]);
  return { id: row!.id, token, prefix };
}

export async function revokeToken(actorId: number, id: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `UPDATE api_token SET revoked_at = now() WHERE id = $1 AND actor_id = $2 AND revoked_at IS NULL RETURNING id`,
    [id, actorId]);
  return !!row;
}

/**
 * 키 → 사람. 끊긴 키 · 비활성 계정 · 비활성 사람이면 `null`.
 * 쓸 때마다 `last_used_at` 을 찍는다(「내 정보」에서 마지막으로 쓴 때를 보여 준다).
 */
export async function resolveToken(raw: string): Promise<SessionUser | null> {
  if (!/^tbk_[A-Za-z0-9_-]{20,}$/.test(raw)) return null;
  const row = await queryOne<{
    token_id: number; id: number; name: string; email: string | null; role: Role; admin_grant: boolean | null;
  }>(
    `SELECT t.id AS token_id, a.id, a.display_name AS name, ac.email, ac.role, ${ADMIN_GRANT_SQL}
       FROM api_token t
       JOIN actor a ON a.id = t.actor_id AND a.is_active AND a.type = 'human'
       JOIN account ac ON ac.actor_id = a.id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [hash(raw)]);
  if (!row) return null;
  await query(`UPDATE api_token SET last_used_at = now() WHERE id = $1`, [row.token_id]);
  return { id: row.id, name: row.name, email: row.email ?? "", role: row.role, adminGrant: row.admin_grant === true };
}

// 임시 관리 라우트(app/api/admin/*) 이중 잠금 공용 — ALLOW_DB_INIT + x-admin-secret.
// 목적: (1) 대소문자·앞뒤 공백에 관대하게 비교해 오탐 404를 줄이고,
//       (2) 차단 사유를 서버 로그(stdout → Vercel Functions 로그)에 남겨 진단 가능하게 한다.
//       HTTP 응답은 여전히 404로 라우트 존재를 숨기되, 운영자는 로그로 원인을 안다.
import { timingSafeEqual } from "crypto";

/** ALLOW_DB_INIT 이 켜져 있는지 — "true"/"True"/" TRUE " 등 대소문자·공백 무시 */
export function allowDbInit(): boolean {
  return (process.env.ALLOW_DB_INIT ?? "").trim().toLowerCase() === "true";
}

/** x-admin-secret 이 AUTH_SECRET 과 일치하는지 — 양쪽 trim 후 상수시간 비교
 *  (Vercel env 값에 붙는 후행 개행/공백으로 인한 오탐 방지) */
export function adminSecretMatches(given: string | null): boolean {
  const expected = (process.env.AUTH_SECRET ?? "").trim();
  const g = (given ?? "").trim();
  if (!expected || !g) return false;
  const a = Buffer.from(g);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 두 잠금을 검사하고 차단 사유를 반환한다. 통과 시 null.
 * 반환 문자열은 로그 전용 — HTTP 응답 본문에는 노출하지 않는다(존재 은폐 유지).
 * 사유에 시크릿 원문은 절대 넣지 않고 길이/설정 여부만 담아 진단을 돕는다.
 */
export function adminLockReason(request: Request): string | null {
  if (!allowDbInit()) {
    const raw = process.env.ALLOW_DB_INIT;
    return `ALLOW_DB_INIT 잠금 — 값이 'true'가 아님 (설정됨=${raw != null}, 원문 길이=${(raw ?? "").length})`;
  }
  const given = request.headers.get("x-admin-secret");
  const expected = (process.env.AUTH_SECRET ?? "").trim();
  if (!adminSecretMatches(given)) {
    return `x-admin-secret 불일치 (전달 길이=${(given ?? "").trim().length}, 기대 길이=${expected.length}, AUTH_SECRET 설정=${expected.length > 0})`;
  }
  return null;
}

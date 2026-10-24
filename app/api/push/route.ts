// 데스크톱 알림 — 내 기기 등록 · 종류 고르기 · 끄기 (0041).
//
// 기기 주소(endpoint)로 서버가 직접 요청을 보내므로 **아무 주소나 받지 않는다** — 브라우저
// 푸시 서버들(구글 · 모질라 · 마이크로소프트 · 애플)만. 안 그러면 서버를 시켜 내부 주소를
// 두드리게 할 수 있다. 로컬 검사에서만 http://localhost 를 연다.
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { query } from "@/lib/db";
import { PUSH_KINDS, pushPublicKey, type PushKind } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/,
  /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/];
function okEndpoint(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? ""));
    if (u.protocol === "https:" && PUSH_HOSTS.some((h) => h.test(u.hostname))) return u.toString().slice(0, 1000);
    if (process.env.NODE_ENV !== "production" && u.protocol === "http:" && u.hostname === "localhost") return u.toString();
    return null;
  } catch { return null; }
}
const b64 = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{8,200}={0,2}$/.test(v) ? v : null);
function kindsOf(v: unknown): PushKind[] | null {
  if (!Array.isArray(v)) return null;
  const k = v.filter((x): x is PushKind => PUSH_KINDS.some((p) => p.key === x));
  return Array.from(new Set(k));
}

export async function GET() {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const devices = await query<{ id: number; endpoint: string; kinds: string[]; user_agent: string | null; created_at: string; last_ok_at: string | null }>(
      `SELECT id, endpoint, kinds, user_agent, created_at::text, last_ok_at::text FROM push_subscription
        WHERE actor_id = $1 AND disabled_at IS NULL ORDER BY id DESC`, [live.user.id]);
    return NextResponse.json({ publicKey: pushPublicKey(), kinds: PUSH_KINDS,
      devices: devices.map((d) => ({ id: d.id, endpoint: d.endpoint, kinds: d.kinds, userAgent: d.user_agent, createdAt: d.created_at, lastOkAt: d.last_ok_at })) });
  } catch (error) {
    return jsonError(error);
  }
}

/** 이 기기 등록. 같은 주소가 있으면 **지금 로그인한 사람의 것**으로 바꾼다(기기를 넘겨받은 경우) */
export async function POST(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    if (!pushPublicKey()) return NextResponse.json({ error: "알림 서버 설정(VAPID)이 아직 없습니다. 관리자에게 알려 주세요." }, { status: 503 });
    const p = await request.json().catch(() => ({}));
    const endpoint = okEndpoint(p.subscription?.endpoint);
    const p256dh = b64(p.subscription?.keys?.p256dh), auth = b64(p.subscription?.keys?.auth);
    if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: "알림 등록 정보가 올바르지 않습니다." }, { status: 400 });
    const kinds = kindsOf(p.kinds) ?? PUSH_KINDS.map((k) => k.key);
    await query(
      `INSERT INTO push_subscription (actor_id, endpoint, p256dh, auth, kinds, user_agent)
       VALUES ($1, $2, $3, $4, $5::text[], $6)
       ON CONFLICT (endpoint) DO UPDATE SET actor_id = EXCLUDED.actor_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         kinds = EXCLUDED.kinds, user_agent = EXCLUDED.user_agent, disabled_at = NULL, fail_count = 0`,
      [live.user.id, endpoint, p256dh, auth, kinds, (request.headers.get("user-agent") ?? "").slice(0, 300)]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

/** 이 기기에서 받을 종류 */
export async function PATCH(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const p = await request.json().catch(() => ({}));
    const kinds = kindsOf(p.kinds);
    if (!kinds) return NextResponse.json({ error: "알림 종류가 올바르지 않습니다." }, { status: 400 });
    const rows = await query(`UPDATE push_subscription SET kinds = $3::text[] WHERE endpoint = $1 AND actor_id = $2 AND disabled_at IS NULL RETURNING id`,
      [String(p.endpoint ?? ""), live.user.id, kinds]);
    return rows.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "이 기기는 등록되어 있지 않습니다." }, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

/** 끄기 — 주소(이 기기) 또는 번호(목록에서 다른 기기) */
export async function DELETE(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const p = await request.json().catch(() => ({}));
    const rows = await query(
      `UPDATE push_subscription SET disabled_at = now()
        WHERE actor_id = $1 AND disabled_at IS NULL AND (endpoint = $2 OR id = $3) RETURNING id`,
      [live.user.id, String(p.endpoint ?? ""), Number.isInteger(p.id) ? p.id : -1]);
    return rows.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "끌 기기를 찾을 수 없습니다." }, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

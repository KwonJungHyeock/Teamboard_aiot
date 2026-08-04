// 링크 언퍼 (MD-P-2026-005 §C) — 캔버스 링크 블록의 카드 메타(제목·도메인·제공자·썸네일).
// 우선 대상: Figma · Notion · GitHub. 원격 조회는 짧은 타임아웃으로 시도하고,
// 실패하면 URL에서 파생한 메타로 폴백한다(네트워크 없이도 카드가 깨지지 않게).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function providerOf(host: string): string {
  if (host.includes("figma.com")) return "Figma";
  if (host.includes("notion.so") || host.includes("notion.site")) return "Notion";
  if (host.includes("github.com")) return "GitHub";
  return host.replace(/^www\./, "");
}

/** URL만으로 만드는 폴백 제목 — 마지막 경로 조각을 사람이 읽을 수 있게. */
function titleFromUrl(u: URL, provider: string): string {
  const seg = u.pathname.split("/").filter(Boolean);
  if (provider === "GitHub" && seg.length >= 2) return `${seg[0]}/${seg[1]}`;
  const last = seg[seg.length - 1] ?? u.hostname;
  return decodeURIComponent(last)
    .replace(/[-_]+/g, " ")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/\s*[0-9a-f]{8,}$/i, "") // Notion/Figma의 긴 해시 꼬리 제거
    .trim() || u.hostname;
}

function pick(html: string, res: RegExp[]): string | null {
  for (const re of res) {
    const m = html.match(re);
    if (m?.[1]) return m[1].trim().slice(0, 300);
  }
  return null;
}

export async function POST(request: Request) {
  try {
    requireSession();
    const { url } = await request.json();
    let u: URL;
    try {
      u = new URL(String(url));
    } catch {
      return NextResponse.json({ error: "올바른 URL이 아닙니다." }, { status: 400 });
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return NextResponse.json({ error: "http(s) 링크만 지원합니다." }, { status: 400 });
    }
    const provider = providerOf(u.hostname);
    const domain = u.hostname.replace(/^www\./, "");
    const fallback = { title: titleFromUrl(u, provider), domain, provider, thumbnail: "" };

    // 원격 메타 시도 — 2.5초 안에 못 가져오면 폴백(오프라인·차단 환경에서도 동작)
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(u.toString(), {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MissionDeck/1.0; +link-preview)" },
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) return NextResponse.json({ meta: fallback });
      const html = (await res.text()).slice(0, 200_000);
      const title = pick(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
        /<title[^>]*>([^<]+)<\/title>/i,
      ]);
      const thumb = pick(html, [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      ]);
      return NextResponse.json({
        meta: {
          title: title || fallback.title,
          domain, provider,
          thumbnail: thumb && /^https?:\/\//.test(thumb) ? thumb : "",
        },
      });
    } catch {
      return NextResponse.json({ meta: fallback });
    }
  } catch (error) {
    return jsonError(error);
  }
}

// 링크 언퍼 (MD-P-2026-005 §C) — 캔버스 링크 블록의 카드 메타(제목·도메인·제공자·썸네일).
// 우선 대상: Figma · Notion · GitHub. 원격 조회는 짧은 타임아웃으로 시도하고,
// 실패하면 URL에서 파생한 메타로 폴백한다(네트워크 없이도 카드가 깨지지 않게).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InternalKind = "task" | "decision" | "project";
export interface InternalCard {
  kind: InternalKind;
  id: number;
  title: string;
  statusLabel: string;
  statusTone: string;      // CSS 변수명 — 상태 칩 색
  assigneeName: string | null;
  progress: number | null; // 진척% (결정은 null)
  href: string;
}

const TASK_STATUS: Record<string, [string, string]> = {
  todo: ["대기", "--slate"], doing: ["진행", "--blue"], review: ["리뷰", "--purple"], done: ["완료", "--green"],
};
const PROJ_STATUS: Record<string, [string, string]> = {
  active: ["진행", "--blue"], hold: ["보류", "--amber"], done: ["완료", "--green"], archived: ["보관", "--slate"],
};
const DEC_STATUS: Record<string, [string, string]> = {
  confirmed: ["확정", "--green"], superseded: ["번복됨", "--slate"],
};

/** 내부 URL → {kind, id}. 같은 오리진의 업무·결정·프로젝트 링크만 인정한다. */
function internalRef(u: URL, origin: string): { kind: InternalKind; id: number } | null {
  if (u.origin !== origin) return null;
  const num = (v: string | null) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  // ?panel=task:12 · ?task=12 · ?signal=... (논의는 언퍼 대상 아님)
  const panel = u.searchParams.get("panel");
  if (panel) {
    const [k, idStr] = panel.split(":");
    const id = num(idStr);
    if (id && (k === "task" || k === "decision")) return { kind: k, id };
  }
  const t = num(u.searchParams.get("task"));
  if (t) return { kind: "task", id: t };
  // /projects/12
  const seg = u.pathname.split("/").filter(Boolean);
  if (seg[0] === "projects") {
    const id = num(seg[1] ?? null);
    if (id) return { kind: "project", id };
  }
  return null;
}

async function loadInternal(ref: { kind: InternalKind; id: number }): Promise<{
  meta: { title: string; domain: string; provider: string; thumbnail: string };
  card: InternalCard;
} | null> {
  let card: InternalCard | null = null;
  if (ref.kind === "task") {
    const r = await queryOne<{ id: number; title: string; status: string; progress: number; assignee: string | null }>(
      `SELECT t.id, t.title, t.status, t.progress, a.display_name AS assignee
       FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE t.id = $1 AND t.is_active = true`,
      [ref.id]
    );
    if (r) {
      const [label, tone] = TASK_STATUS[r.status] ?? [r.status, "--slate"];
      card = { kind: "task", id: r.id, title: r.title, statusLabel: label, statusTone: tone,
        assigneeName: r.assignee, progress: r.progress, href: `?panel=task:${r.id}` };
    }
  } else if (ref.kind === "project") {
    const r = await queryOne<{ id: number; name: string; status: string; owner: string | null }>(
      `SELECT p.id, p.name, p.status, a.display_name AS owner
       FROM project p LEFT JOIN actor a ON a.id = p.owner_id
       WHERE p.id = $1 AND p.is_active = true`,
      [ref.id]
    );
    if (r) {
      // 진척은 업무 기간 가중 평균(프로젝트 롤업)과 같은 규칙
      const agg = await queryOne<{ p: string | null }>(
        `SELECT round(avg(progress))::text AS p FROM task
         WHERE project_id = $1 AND is_active = true`,
        [ref.id]
      );
      const [label, tone] = PROJ_STATUS[r.status] ?? [r.status, "--slate"];
      card = { kind: "project", id: r.id, title: r.name, statusLabel: label, statusTone: tone,
        assigneeName: r.owner, progress: agg?.p === null || agg?.p === undefined ? null : Number(agg.p),
        href: `/projects/${r.id}` };
    }
  } else {
    const r = await queryOne<{ id: number; title: string; status: string; by: string }>(
      `SELECT d.id, d.title, d.status, a.display_name AS by
       FROM decision d JOIN actor a ON a.id = d.decided_by WHERE d.id = $1`,
      [ref.id]
    );
    if (r) {
      const [label, tone] = DEC_STATUS[r.status] ?? [r.status, "--slate"];
      card = { kind: "decision", id: r.id, title: r.title, statusLabel: label, statusTone: tone,
        assigneeName: r.by, progress: null, href: `?panel=decision:${r.id}` };
    }
  }
  if (!card) return null;
  const KIND_LABEL: Record<InternalKind, string> = { task: "업무", decision: "결정", project: "프로젝트" };
  return {
    meta: { title: card.title, domain: "Mission Deck", provider: KIND_LABEL[card.kind], thumbnail: "" },
    card,
  };
}

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
      // 내부 링크는 상대 경로로 붙여넣는 경우가 많다 — 요청 오리진 기준으로 해석한다.
      u = new URL(String(url), new URL(request.url).origin);
    } catch {
      return NextResponse.json({ error: "올바른 URL이 아닙니다." }, { status: 400 });
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return NextResponse.json({ error: "http(s) 링크만 지원합니다." }, { status: 400 });
    }

    // ── 내부 링크 언퍼 (MD-P-2026-006 §E) ──
    // 업무·결정·프로젝트 URL은 외부 조회 없이 DB에서 카드를 만든다.
    const ref = internalRef(u, new URL(request.url).origin);
    if (ref) {
      const internal = await loadInternal(ref);
      if (internal) return NextResponse.json({ meta: internal.meta, internal: internal.card });
      // 대상이 없으면 언퍼하지 않는다 — 호출부는 원본 링크 텍스트를 유지한다.
      return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
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

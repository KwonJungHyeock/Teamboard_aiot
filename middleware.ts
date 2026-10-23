// 페이지 접근 가드 — 세션 쿠키 없으면 /login으로. (서명 검증은 서버 컴포넌트/API에서 수행)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { V3_BASE, v3Destination } from "./lib/v3/routes";
import { notYetForOld, notYetHref } from "./lib/v3/not-yet";

const SESSION_COOKIE = "tb_session";
/** 미들웨어가 실어 주는 지금 경로. `app/v3/layout.tsx` 가 읽는다. */
export const PATH_HEADER = "x-tb-path";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/brand") || // 브랜드 로고 등 공개 자산(로그인 전 표시)
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  /*
   * ── 2026-10 옛 화면 철거 — 옛 주소는 **여기서** 새 화면으로 보낸다 ──────
   *
   * 옛 셸(`AppShell`)이 하던 일이다. 셸과 옛 화면을 지웠으니 같은 표(`ROUTE_PAIRS` ·
   * `NOT_YET`)를 여기서 읽는다 — 둘 다 DB 를 안 읽는 순수한 표라 미들웨어에서 된다.
   *   · 막힌 것(아직 새 화면이 없는 것)이 먼저 → 막음 화면
   *   · 짝이 있으면 → 그 새 화면(이유 `?denied=` 는 따라간다)
   *   · 나머지 옛 주소 → 첫 화면(관제). 404 보다 낫다 — 북마크가 옛 주소다.
   */
  if (!pathname.startsWith(V3_BASE)) {
    const full = pathname + request.nextUrl.search;
    const blocked = notYetForOld(pathname);
    const to = blocked ? notYetHref(blocked.key) : (v3Destination(full) ?? `${V3_BASE}/control${request.nextUrl.search}`);
    // 개발 서버는 요청 주소의 호스트를 localhost 로 바꿔 놓는다 — 로컬 검사는 `BASE=http://localhost:3000` 으로 돈다.
    return NextResponse.redirect(new URL(to, request.url));
  }
  /*
   * 지금 경로를 **서버 컴포넌트가 읽을 수 있게** 넘긴다 (MD-P-2026-043 §C).
   * 새 화면 뿌리(`app/v3/layout.tsx`)가 열한 화면 밖의 주소를 막음 화면으로 보낼 때 쓴다.
   * **쿼리까지** 넘긴다.
   */
  const h = new Headers(request.headers);
  h.set(PATH_HEADER, pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers: h } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

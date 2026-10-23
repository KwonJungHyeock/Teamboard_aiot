// v3 「공간 모드」 — 화면 **겉모습만** 바꾸는 개인 스위치.
//
// ── `lib/v3/switch.ts` 와 무엇이 다른가 ─────────────────────────
//
// 그쪽은 「새 화면을 여느냐」라서 **서비스 전체에 한 값**이다(042 §B) — 두 화면이
// 동시에 돌면 링크가 엇갈린다. 여기는 **주소 · 데이터 · 기능이 하나도 안 바뀐다.**
// 같은 링크를 열면 같은 업무가 나오고 색과 깊이만 다르다. 그래서 사람마다 달라도 된다.
//
// ── 왜 DB 가 아니라 쿠키인가 ─────────────────────────────────────
//
// 겉모습 하나 때문에 표 · 마이그레이션 · API 를 만들지 않는다(033 의 판단과 같다).
// 켜고 끄는 것이 **그 사람 브라우저 안에서 끝난다** — 서버에 쓰는 것이 없다.
// 기본은 꺼짐이다: 쿠키가 없으면 지금 화면 그대로다.
//
// 이 파일은 순수한 값만 둔다 — 서버 레이아웃과 클라이언트 껍데기가 같이 쓴다
// (`routes.ts` 가 `switch.ts` 와 갈라진 것과 같은 이유).

/** 쿠키 이름. 값이 `LOOK_SPACE` 일 때만 켜짐이다. */
export const LOOK_COOKIE = "v3_look";
export const LOOK_SPACE = "space";
/** 1년. 끄면 지운다(max-age=0). */
export const LOOK_MAX_AGE = 60 * 60 * 24 * 365;

export function isSpace(v: string | undefined | null): boolean {
  return v === LOOK_SPACE;
}

/** 브라우저에서 쿠키를 적는 한 줄. 켜면 남기고, 끄면 지운다. */
export function lookCookie(on: boolean): string {
  return on
    ? `${LOOK_COOKIE}=${LOOK_SPACE}; path=/; max-age=${LOOK_MAX_AGE}; samesite=lax`
    : `${LOOK_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

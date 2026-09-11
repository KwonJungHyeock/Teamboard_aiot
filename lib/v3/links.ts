// v3 「첨부」 — 기록에서 링크를 뽑는 규칙 (MD-P-2026-051 §C). 순수 함수다.
//
// ── 저장하는 것이 없다 ──────────────────────────────────────────
//
// 파일을 올리지 않는다. 저장소도 안 붙인다. DB·API 도 안 건드린다.
// **`task.description` 에 이미 적혀 있는 URL 을 읽어서 아래에 다시 보일 뿐이다.**
//
// ── 본문은 손대지 않는다 ────────────────────────────────────────
//
// URL 은 본문에 **그대로 남는다.** 뽑아서 지우거나 고쳐 쓰면 사용자가 적은
// 것이 바뀐다 — 적은 사람은 자기가 안 지운 것이 사라진 것을 보게 된다.
// 이 파일에 본문을 바꾸는 함수가 없는 이유다.

/**
 * 링크의 종류. 무엇을 그릴지가 여기서 갈린다.
 *
 *   image  썸네일
 *   pdf    파일 카드
 *   drive · notion · figma  어디 것인지 아는 링크 카드
 *   link   링크 칩 (도메인 + 경로 끝)
 *   plain  **http.** 링크 칩만 — 미리보기를 만들지 않는다
 */
export type LinkKind = "image" | "pdf" | "drive" | "notion" | "figma" | "link" | "plain";

export interface LinkItem {
  url: string;
  kind: LinkKind;
  /** 칩·카드에 적을 말. 「도메인 · 경로 끝」 */
  label: string;
  host: string;
  /** https 인가. **아니면 미리보기를 안 만든다.** */
  secure: boolean;
}

/** 한 업무에 그리는 최대 개수. 넘으면 「＋n개 더」로 접는다. */
export const MAX_LINKS = 8;

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

/**
 * 어디 것인지 아는 곳. **호스트 끝으로** 맞춘다 —
 * `includes` 로 보면 `evil.com/drive.google.com` 이 통과한다.
 */
const KNOWN: { suffix: string; kind: LinkKind; name: string }[] = [
  { suffix: "drive.google.com", kind: "drive", name: "구글 드라이브" },
  { suffix: "docs.google.com", kind: "drive", name: "구글 문서" },
  { suffix: "notion.so", kind: "notion", name: "Notion" },
  { suffix: "figma.com", kind: "figma", name: "Figma" },
];

export const KIND_LABEL: Record<LinkKind, string> = {
  image: "이미지", pdf: "PDF", drive: "구글 드라이브", notion: "Notion",
  figma: "Figma", link: "링크", plain: "링크 (http)",
};

/** 글 속의 URL 은 문장부호를 달고 끝난다 — `(…링크).` 의 `).` 까지 주소로 읽히지 않게. */
function trimTail(raw: string): string {
  let s = raw;
  while (s.length > 0 && ".,;:!?".includes(s[s.length - 1])) s = s.slice(0, -1);
  // 짝이 안 맞는 닫는 괄호만 뗀다. 주소 안의 괄호(위키 링크)는 남긴다.
  const pairs: [string, string][] = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    while (s.endsWith(close)
      && s.split(close).length - 1 > s.split(open).length - 1) s = s.slice(0, -1);
  }
  return s;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function pathTail(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "");
    const last = p.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last);
  } catch { return ""; }
}

/** 확장자를 **경로에서만** 본다. `?v=1.png` 같은 물음표 뒤는 파일 이름이 아니다. */
function extOf(url: string): string {
  try {
    const p = new URL(url).pathname.toLowerCase();
    const dot = p.lastIndexOf(".");
    return dot === -1 ? "" : p.slice(dot);
  } catch { return ""; }
}

export function kindOf(url: string): LinkKind {
  // **http 는 미리보기를 안 만든다** (지시 §C-3). 종류를 안 따지고 칩으로만 둔다.
  if (!/^https:\/\//i.test(url)) return "plain";
  const ext = extOf(url);
  if (IMAGE_EXT.includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  const host = hostOf(url);
  const known = KNOWN.find((k) => host === k.suffix || host.endsWith(`.${k.suffix}`));
  return known ? known.kind : "link";
}

function labelOf(url: string): string {
  const host = hostOf(url).replace(/^www\./, "");
  const tail = pathTail(url);
  return tail ? `${host} · ${tail}` : host;
}

/**
 * 기록에서 URL 을 뽑는다. **같은 주소는 한 번만.**
 *
 * 본문에 두 번 적혀 있어도 카드는 하나다 — 같은 그림이 둘 뜨면 두 개가 있는
 * 줄로 읽힌다. 적힌 차례는 지킨다.
 */
export function extractLinks(text: string | null | undefined): LinkItem[] {
  if (!text) return [];
  const out: LinkItem[] = [];
  const seen = new Set<string>();
  // `matchAll` 대신 `exec` 를 도는 이유는 취향이 아니다 — 이 리포의 tsc 목표가
  // 반복자를 안 펴 준다. 결과는 같다.
  const re = /https?:\/\/[^\s<>"']+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const url = trimTail(m[0]);
    const host = hostOf(url);
    if (host === "" || seen.has(url)) continue;      // 주소로 못 읽히면 버린다
    seen.add(url);
    out.push({ url, kind: kindOf(url), label: labelOf(url), host, secure: /^https:/i.test(url) });
  }
  return out;
}

/** 목록 행의 클립 숫자. **썸네일은 안 그린다** — 목록에 그림이 들어가면 무거워진다. */
export function countLinks(text: string | null | undefined): number {
  return extractLinks(text).length;
}

/** 여덟까지 그리고 나머지는 접는다. **몇 개가 접혔는지는 보인다.** */
export function foldLinks(items: LinkItem[], max = MAX_LINKS): { shown: LinkItem[]; more: number } {
  if (items.length <= max) return { shown: items, more: 0 };
  return { shown: items.slice(0, max), more: items.length - max };
}

/** 미리보기를 만드는 종류인가. http 와 그냥 링크는 칩으로만 선다. */
export function hasPreview(kind: LinkKind): boolean {
  return kind === "image" || kind === "pdf" || kind === "drive"
    || kind === "notion" || kind === "figma";
}

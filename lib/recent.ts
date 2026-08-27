// 최근 본 것 (MD-P-2026-031 §C3 ④) — 레일의 **복귀 도구**.
// "어제 보던 업무로 한 번에 돌아가는 것"이 이 목록의 전부다.
//
// ── 무엇을 저장하는가: **종류와 id 뿐이다** ──────────────────────────
//
// 제목·담당·상태는 저장하지 않는다. 두 가지 이유가 있다.
//
//   ① 제목을 굽어 두면 **낡는다.** 이름을 고친 업무가 레일에서만 옛 이름으로 남고,
//      그러면 레일이 화면과 다른 말을 한다. 여기는 캐시가 아니라 **북마크**다.
//   ② 개인 업무·개인 목표의 제목이 브라우저 저장소에 남는다. 로그아웃해도 남고,
//      공용 PC 에서 다음 사람의 브라우저에 남는다. **id 는 그 자체로는 아무 말도 안 한다** —
//      제목은 서버가 그때그때 권한을 보고 준다(`/api/meta/recent`).
//
// ── 지워진 항목 ────────────────────────────────────────────────────
// 조용히 건너뛴다. 「삭제된 업무입니다」를 띄우지 않는다 — 복귀 도구에 뜨는 오류는
// 사용자가 한 일이 아니고, 할 수 있는 일도 없다. 목록에서 빠지는 것이 답이다.
// 서버가 못 찾은 항목은 응답에서 빠지고, 여기서 저장소도 같이 정리한다.

/** 최근 본 것에 담을 수 있는 종류. 여기 없는 것은 담지 않는다. */
export const RECENT_KINDS = ["task", "goal", "project"] as const;
export type RecentKind = (typeof RECENT_KINDS)[number];

export interface RecentRef { kind: RecentKind; id: number }

/** 화면에 그릴 때 서버가 채워 주는 것. **저장소에는 없다.** */
export interface RecentItem extends RecentRef {
  title: string;
  /** 종류 라벨 (`업무`·`목표`·`프로젝트`) */
  label: string;
  /** 눌렀을 때 갈 곳 */
  href: string;
}

/** `tb:recent-*` — 사람마다 다르게 담는다. 공용 PC 에서 계정을 바꾸면 목록도 바뀐다. */
const keyFor = (userId: number) => `tb:recent-${userId}`;

/*
 * 사람 id 는 **호출부가 넘긴다.** 모듈에 「지금 사람」을 하나 두고 AppShell 이 심는
 * 방식을 먼저 써 봤는데, React 는 자식 effect 를 부모보다 **먼저** 돌린다 —
 * 첫 마운트에서 패널이 담으려는 순간 그 값이 아직 없다. 조용히 안 담기고,
 * 두 번째부터 담긴다. 그런 버그는 재현이 안 된다.
 *
 * 호출부는 넷뿐이고 전부 이미 `user` 를 들고 있다. 타입이 빠뜨림을 잡는다.
 */

/** 담아 두는 최대 개수. 레일에 보이는 것보다 넉넉히 둔다 — 지워진 것이 섞이면 줄어든다. */
const CAP = 20;

function read(userId: number): RecentRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 저장소는 **남이 쓴 값**일 수 있다(옛 버전·손으로 고친 값). 모양을 믿지 않는다.
    return parsed
      .filter((v): v is RecentRef =>
        !!v && typeof v === "object" &&
        RECENT_KINDS.includes((v as RecentRef).kind) &&
        Number.isInteger((v as RecentRef).id) && (v as RecentRef).id > 0)
      .map((v) => ({ kind: v.kind, id: v.id }))
      .slice(0, CAP);
  } catch {
    // 사파리 프라이빗·저장소 꽉 참·JSON 깨짐. 복귀 도구가 화면을 죽이면 안 된다.
    return [];
  }
}

function write(userId: number, refs: RecentRef[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(refs.slice(0, CAP)));
  } catch {
    // 저장이 안 돼도 화면은 돈다. 다음에 다시 담긴다.
  }
}

/** 목록을 읽는다 (id·종류만). 제목은 `/api/meta/recent` 가 준다. */
export function recentRefs(userId: number): RecentRef[] {
  return read(userId);
}

/**
 * 하나 담는다. 이미 있으면 **맨 앞으로 올린다** — 같은 것을 두 줄로 두지 않는다.
 * 패널을 열 때마다 불린다. 값이 그대로면 저장소도 안 건드린다(같은 것을 계속 다시 여는 경우).
 */
export function pushRecent(userId: number, kind: RecentKind, id: number) {
  if (!RECENT_KINDS.includes(kind) || !Number.isInteger(id) || id <= 0) return;
  const cur = read(userId);
  if (cur[0]?.kind === kind && cur[0]?.id === id) return;
  write(userId, [{ kind, id }, ...cur.filter((r) => !(r.kind === kind && r.id === id))]);
}

/**
 * 서버가 못 찾은 것(지워졌거나 볼 수 없는 것)을 저장소에서도 뺀다.
 * 안 빼면 **매번 다시 물어보고 매번 빠진다** — 조용하지만 낭비다.
 */
export function pruneRecent(userId: number, alive: RecentRef[]) {
  const live = new Set(alive.map((r) => `${r.kind}:${r.id}`));
  const cur = read(userId);
  const next = cur.filter((r) => live.has(`${r.kind}:${r.id}`));
  if (next.length !== cur.length) write(userId, next);
}

/** 저장소 표기 ↔ 요청 문자열. 서버와 화면이 **같은 한 벌**을 쓴다. */
export const encodeRefs = (refs: RecentRef[]) => refs.map((r) => `${r.kind}:${r.id}`).join(",");

export function decodeRefs(raw: string | null): RecentRef[] {
  if (!raw) return [];
  const out: RecentRef[] = [];
  for (const part of raw.split(",").slice(0, CAP)) {
    const [kind, idStr] = part.split(":");
    const id = Number(idStr);
    if (RECENT_KINDS.includes(kind as RecentKind) && Number.isInteger(id) && id > 0) {
      out.push({ kind: kind as RecentKind, id });
    }
  }
  return out;
}

export const RECENT_LABEL: Record<RecentKind, string> = {
  task: "업무", goal: "목표", project: "프로젝트",
};

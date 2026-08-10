"use client";
// 목록 화면의 초기값을 **한 곳에서** 읽는다 (MD-P-2026-031 §C 회신 4).
//
// ── 왜 훅으로 모으는가 ──────────────────────────────────────────────
//
// 「중간 상태도 상태다」가 두 번 걸렸고 **둘 다 초기값이 하나 늘어난 순간** 났다.
//   · 정렬이 늘었을 때 — 기본 정렬로 한 번 받고 다시 받았다. 그 사이에 틀린 순서가 보였다.
//   · 영역이 늘었을 때 — 전체 목록을 한 번 그리고 내 영역 목록으로 다시 그렸다.
// §C3·§D 에서 초기값은 더 는다(묶기 · span · 담당자 · 검색어).
// 같은 버그가 세 번째로 나기 전에 **구조로 막는다.**
//
// 규약은 셋이다.
//   ① 주소 · 저장값 · 기본값을 **이 훅만 읽는다.** 부르는 쪽은 `ready` 만 본다.
//   ② 다 정해지기 전에는 `ready:false` — 그동안 목록을 부르지 않는다. 스켈레톤이다.
//   ③ 기본값은 주소에 쓰지 않는다. 바뀐 것만 남는다. history 는 쌓지 않는다(replaceState).
//
// 새 파라미터가 늘어도 부르는 쪽 코드는 안 바뀐다. 그게 이 훅의 전부다.
import { useCallback, useEffect, useState } from "react";

export interface ParamSpec {
  /** 기본값. **이 값이면 주소에 안 쓴다.** */
  def: string;
  /** 허용값. 목록 밖이면 400 이 아니라 기본값으로 조용히 떨어뜨린다(§C 회신 2-4). */
  values?: readonly string[];
  /**
   * 열거할 수 없는 값의 허용 판정(담당자 id 처럼). `values` 와 **같은 규칙**이고
   * 적는 방법만 다르다 — 목록으로 쓸 수 있으면 `values` 를 쓴다.
   * 둘 다 있으면 둘 다 통과해야 한다.
   */
  test?: (v: string) => boolean;
  /** localStorage 키. 없으면 저장하지 않는다(주소로만 산다). */
  store?: string;
  /** 옛 값 → 새 값. 이름만 바뀐 것은 **조용히** 옮긴다. */
  alias?: Record<string, string>;
  /** 기능이 없어진 값. 매핑은 하되 **한 번은 말한다** — 조용히 바뀌면 고장으로 읽힌다. */
  gone?: readonly string[];
}

export type ListQuerySpec = Record<string, ParamSpec>;

/**
 * 값 하나를 규약대로 고른다. **읽는 자리가 서버든 클라이언트든 같은 함수를 쓴다** —
 * 두 벌로 쓰면 서버가 그린 것과 클라이언트가 그린 것이 갈라진다(하이드레이션 불일치).
 */
function normalize(s: ParamSpec, raw: string | null): { v: string; gone: boolean } {
  let v = raw ?? s.def;
  let gone = false;
  if (s.alias && v in s.alias) {
    gone = !!s.gone?.includes(v);
    v = s.alias[v];
  }
  // 목록/판정 밖이면 조용히 기본값. 400 이 아니다.
  if ((s.values && !s.values.includes(v)) || (s.test && !s.test(v))) v = s.def;
  return { v, gone };
}

export interface ListQuery<K extends string> {
  /** 초기값을 다 읽었는가. **거짓이면 목록을 부르지 않는다.** */
  ready: boolean;
  value: Record<K, string>;
  set: (key: K, v: string) => void;
  /** 기능이 없어져 기본값으로 떨어진 파라미터 — 화면이 한 번 안내한다. */
  dropped: K[];
  /** 안내를 닫는다. 세션당 1회. */
  dismiss: (key: K) => void;
}

/**
 * @param initial 서버가 읽은 **주소 쿼리 전체**(그 화면이 쓰는 키에 한해). 키가 없으면
 *   "주소에 없었다"는 뜻이다 — 안 넘긴 것과 구별된다.
 *
 * 왜 필요한가. 컴포넌트가 클라이언트여도 **첫 HTML 은 서버가 그린다.** 훅이 마운트
 * 이펙트에서만 읽으면 하이드레이션이 끝날 때까지 기본값 화면이 나간다. 한 프레임이 아니다 —
 * 실측에서 `/?span=all` 인데 「이번 분기」 칩이 켜진 채로 잡혔고, `/tasks?sort=priority` 는
 * 서버 HTML 에 `기한순 selected` 가 박혀 나왔다.
 *
 * **서버가 답을 아는 키는 첫 바이트부터 맞는다.** 아는 키는 둘이다.
 *   · 주소에 값이 있는 키 — 주소가 저장값을 이기므로 그 값이 곧 답이다.
 *   · 저장값을 안 보는 키(`store` 없음) — 주소에 없으면 기본값이 답이다.
 * 나머지(주소에 없고 저장값을 보는 키)는 서버가 알 수 없다. 그래서 `ready` 는
 * **모든 키를 알 때만** 참으로 시작한다 — 목록은 여전히 그때까지 안 부른다.
 */
export function useListQuery<K extends string>(
  spec: Record<K, ParamSpec>,
  initial?: Partial<Record<K, string>>
): ListQuery<K> {
  const keys = Object.keys(spec) as K[];
  const seedOf = (k: K) => {
    const s = spec[k];
    const fromUrl = initial ? initial[k] ?? null : null;
    return { known: !!initial && (fromUrl !== null || !s.store), ...normalize(s, fromUrl) };
  };

  const [value, setValue] = useState<Record<K, string>>(
    () => Object.fromEntries(keys.map((k) => [k, seedOf(k).v])) as Record<K, string>
  );
  const [ready, setReady] = useState(() => keys.every((k) => seedOf(k).known));
  const [dropped, setDropped] = useState<K[]>(
    () => keys.filter((k) => { const r = seedOf(k); return r.known && r.gone; })
  );

  // ① 읽기 — 주소가 저장값보다 세다(공유 링크가 이긴다).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const next = {} as Record<K, string>;
    const gone: K[] = [];
    for (const k of keys) {
      const s = spec[k];
      const r = normalize(s, sp.get(k) ?? (s.store ? localStorage.getItem(s.store) : null));
      if (r.gone) gone.push(k);
      next[k] = r.v;
      // 저장값도 같이 갱신한다. 안 그러면 들어올 때마다 매핑이 다시 돈다.
      if (s.store) localStorage.setItem(s.store, r.v);
    }
    setValue(next);
    setDropped(gone);
    setReady(true);
    // 마운트 1회. 주소를 나중에 사람이 고치는 경우는 새로고침으로 온다.
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ② 쓰기 — 기본값은 안 적는다. replaceState 라 history 를 안 쌓는다.
  useEffect(() => {
    if (!ready) return;
    const sp = new URLSearchParams(window.location.search);
    for (const k of keys) {
      if (value[k] === spec[k].def) sp.delete(k);
      else sp.set(k, value[k]);
    }
    const qs = sp.toString();
    window.history.replaceState({}, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [ready, value]);   // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((key: K, v: string) => {
    setValue((prev) => ({ ...prev, [key]: v }));
    const s = spec[key];
    if (s.store) localStorage.setItem(s.store, v);
  }, [spec]);

  const dismiss = useCallback((key: K) => setDropped((prev) => prev.filter((k) => k !== key)), []);

  return { ready, value, set, dropped, dismiss };
}

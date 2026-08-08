"use client";

// 영역 필터 칩 (MD-P-2026-027 §B2 · B11-3).
//
// 영역을 사이드바에서 내렸으므로(§B2), 영역으로 묶어 보던 축은 **필터로 살려야** 한다.
// 그 축이 업무 화면에만 남으면 "R&D 프로젝트만" · "플랫폼 목표만" 을 볼 방법이 없어진다.
//
// 그래서 칩을 컴포넌트 하나로 만들어 업무·프로젝트·목표가 **같은 것을 쓴다.**
// 화면마다 따로 그리면 색·간격·다중선택 여부가 갈리고, 그중 하나는 반드시 낡는다.
import { useCallback, useEffect, useState } from "react";

export interface AreaChip {
  id: number;
  name: string;
  colorKey: string | null;
}

/** URL 의 `?area=2,3` → id 배열. 빈 값·쓰레기는 조용히 버린다. */
export function parseAreaParam(v: string | null | undefined): number[] {
  if (!v) return [];
  return v.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

/** id 배열 → `?area=2,3`. 비어 있으면 빈 문자열(= 파라미터를 지운다). */
export function areaParam(ids: number[]): string {
  return ids.slice().sort((a, b) => a - b).join(",");
}

/**
 * 영역 목록을 한 번만 받아 온다.
 * `/api/meta/selectors` 는 화면마다 이미 부르는 곳이 있어서, 여기서는
 * **영역만 필요한 화면**(프로젝트·목표)이 쓴다.
 */
export function useAreaChips(): AreaChip[] {
  const [areas, setAreas] = useState<AreaChip[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/meta/selectors")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setAreas(d.areas ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return areas;
}

/**
 * URL 과 묶인 영역 선택 상태.
 * history 를 쌓지 않는다 — 칩을 몇 번 누르면 뒤로가기가 필터 이력으로 차서
 * 화면을 벗어날 수 없게 된다 (업무 화면이 이미 같은 규칙을 쓴다).
 */
export function useAreaSelection(): [number[], (id: number) => void, () => void, string] {
  const [ids, setIds] = useState<number[]>([]);

  useEffect(() => {
    setIds(parseAreaParam(new URLSearchParams(window.location.search).get("area")));
  }, []);

  const sync = useCallback((next: number[]) => {
    setIds(next);
    const sp = new URLSearchParams(window.location.search);
    const p = areaParam(next);
    if (p) sp.set("area", p); else sp.delete("area");
    const qs = sp.toString();
    window.history.replaceState({}, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);

  const toggle = useCallback((id: number) => {
    setIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      sync(next);
      return next;
    });
  }, [sync]);

  const clear = useCallback(() => sync([]), [sync]);

  return [ids, toggle, clear, areaParam(ids)];
}

/** 칩 줄. 전부 끄면 "전체 영역"이다 — 별도 상태가 아니라 선택 0건이 곧 전체다. */
export default function AreaFilter({
  areas, selected, onToggle, onClear,
}: {
  areas: AreaChip[];
  selected: number[];
  onToggle: (id: number) => void;
  onClear: () => void;
}) {
  if (areas.length === 0) return null;
  return (
    <>
      <button className={`pg-chip${selected.length === 0 ? " on" : ""}`} onClick={onClear}>
        전체 영역
      </button>
      {areas.map((a) => (
        <button
          key={a.id}
          className={`pg-chip area-chip${selected.includes(a.id) ? " on" : ""}`}
          aria-pressed={selected.includes(a.id)}
          onClick={() => onToggle(a.id)}
        >
          <i className={`pjdot ${a.colorKey ?? "team"}`} />
          {a.name}
        </button>
      ))}
    </>
  );
}

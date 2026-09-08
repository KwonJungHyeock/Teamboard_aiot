"use client";

// 등록 화면의 프로젝트 고르개 (MD-P-2026-032 §B).
//
// ── 왜 버튼인가 ──────────────────────────────────────────────────
//
// 프로젝트를 고르는 데 드롭다운을 열고 · 읽고 · 고르고 · 닫는 네 동작이 들었다.
// 그래서 아무도 안 골랐고 업무 서른다섯 건이 프로젝트 없이 떠다녔다.
// **버튼은 한 동작이다.** 무엇이 있는지도 열기 전에 보인다.
//
// ── 문턱을 넘으면 콤보로 ─────────────────────────────────────────
//
// 버튼 줄이 길어지면 못 읽는다. `VISIBLE_PROJECT_BUTTON_LIMIT` 을 넘으면
// 검색형 콤보로 바꾸되 **최근 쓴 것 3개를 위로** 올린다(028 §B1 과 같은 패턴).
// 목록을 자르지는 않는다 — 자르면 안 쓰던 프로젝트로 옮길 길이 사라지고,
// **그 이동을 쉽게 만드는 것이 §B 의 목적**이라 정반대가 된다.
import { useEffect, useMemo } from "react";
import ProjectCombo, { type ComboProject, readRecentProjects, rememberProject } from "./ProjectCombo";
import { projectButtons, withRecentFirst, type AreaOption } from "@/lib/project-buttons";

export default function ProjectPicker({
  projects,
  myAreaIds,
  areas,
  value,
  onChange,
  disabled,
  disabledNote,
  canCreate,
  onCreated,
}: {
  projects: ComboProject[];
  /** 내 소속 영역 — **순서가 우선순위다** (`actor_area.sort_order`). */
  myAreaIds: number[];
  areas: AreaOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  disabledNote?: string;
  canCreate?: boolean;
  onCreated?: (p: ComboProject) => void;
}) {
  const set = useMemo(
    () => projectButtons(projects, myAreaIds, areas),
    [projects, myAreaIds, areas]
  );

  // 조용히 틀리지 않는다. **렌더 중이 아니라 effect 에서** 남긴다 —
  // 렌더는 여러 번 돌 수 있고 그때마다 같은 줄이 찍히면 로그가 쓸모를 잃는다.
  useEffect(() => {
    for (const m of set.problems) console.error(`[project-picker] ${m}`);
  }, [set.problems]);

  if (disabled) {
    return <p className="pp-off">{disabledNote ?? "고를 수 없습니다"}</p>;
  }

  // ── 문턱을 넘었을 때 — 콤보. 최근 쓴 것이 위로 ──
  if (set.overflow) {
    const recent = readRecentProjects();
    const order = new Map(
      withRecentFirst(set.buttons, recent).map((b, i) => [b.id, i])
    );
    const sorted = [...projects].sort(
      (a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)
    );
    return (
      <div className="pp">
        <ProjectCombo
          value={value}
          projects={sorted}
          areaId={undefined}
          canCreate={canCreate}
          onChange={(id) => { if (id) rememberProject(id); onChange(id); }}
          onCreated={onCreated}
          // **「연결」이라는 말을 쓰지 않는다** (§B). 업무는 프로젝트에 **속하는** 것이지
          // 나중에 이어 붙이는 것이 아니다. 말이 동작을 만든다.
          placeholder="프로젝트 고르기"
        />
      </div>
    );
  }

  if (set.buttons.length === 0) {
    return <p className="pp-off">고를 수 있는 프로젝트가 없습니다</p>;
  }

  return (
    <div className="pp" role="group" aria-label="프로젝트">
      {set.buttons.map((b) => {
        const on = value === b.id;
        return (
          <button
            key={b.id}
            type="button"
            className={`pp-b${on ? " on" : ""}${b.kind === "standing" ? " st" : ""}`}
            aria-pressed={on}
            onClick={() => {
              // 단일 선택 **토글** — 누른 것을 다시 누르면 벗는다.
              // 「잘못 골랐을 때 되돌릴 길」이 없으면 고르기가 무서워진다.
              if (on) { onChange(null); return; }
              rememberProject(b.id);
              onChange(b.id);
            }}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}

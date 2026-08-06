"use client";

// 빠른 이동 (MD-P-2026-006 §A) — ⌘K / Ctrl+K.
// 화면 이동 항목 + 프로젝트·업무·사람·결정 통합 검색을 한 입력창에서 처리한다.
// 검색 결과 선택은 화면을 옮기는 대신 전역 우측 패널을 연다(업무·논의·멤버·결정).
// 질의가 비어 있으면 최근 항목을 먼저 보여준다(최근 방문 우선).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/types";
import { openTaskPanel, notifyTaskUpdated } from "@/lib/task-panel";
import { openQuickCreate } from "@/lib/quick";
import { openPanel } from "@/lib/side-panel";

interface SearchHit { kind: "project" | "task" | "person" | "decision"; id: number; title: string; meta: string }
const HIT_LABEL: Record<SearchHit["kind"], string> = {
  project: "프로젝트", task: "업무", person: "사람", decision: "결정",
};

interface PaletteItem {
  label: string;
  href: string;
  keywords: string; // 검색 보조어 (영문·초성 등)
  leadOnly?: boolean;
  notionOnly?: boolean; // Notion 연결 시에만 노출 (파트 Z)
  quick?: boolean;    // 빠른 생성 팝오버로 처리(내비게이션 대신)
}

// ── 이동 ──
const NAV_ITEMS: PaletteItem[] = [
  { label: "홈", href: "/", keywords: "home dashboard 대시보드" },
  { label: "내 업무", href: "/tasks", keywords: "task 업무 할일 todo" },
  { label: "캘린더", href: "/calendar", keywords: "calendar 일정 스케줄" },
  { label: "내 에이전트", href: "/assistant", keywords: "assistant agent ai my 에이전트" },
  { label: "목표", href: "/goals", keywords: "goal okr 연간 분기 월" },
  { label: "월간 보고", href: "/reports", keywords: "report 보고서 월말", leadOnly: true },
  { label: "논의·결정", href: "/signals", keywords: "signal 시그널 결정 리뷰 메모 리스크" },
  { label: "허들룸", href: "/huddle", keywords: "huddle 공유 코멘트" },
  { label: "인수인계", href: "/handover", keywords: "handover 인수 인계 이관 퇴사 휴가" },
];

// ── 만들기 ──
const CREATE_ITEMS: PaletteItem[] = [
  { label: "에이전트에게 업무 위임", href: "/assistant", keywords: "위임 초안 draft delegate" },
  { label: "새 업무", href: "/tasks?new=1", keywords: "task new 새 업무 만들기 빠른", quick: true },
  { label: "논의·결정 올리기", href: "/signals?new=1", keywords: "signal 시그널 new 결정 요청" },
];

// ── 관리 (lead 전용) ──
const ADMIN_ITEMS: PaletteItem[] = [
  { label: "업무 현황", href: "/status", keywords: "status 현황 분석 완료 추이 부하 차트", leadOnly: true },
  { label: "구성원 관리", href: "/members", keywords: "member 계정 발급", leadOnly: true },
  { label: "설정", href: "/settings", keywords: "settings notion 연동", leadOnly: true },
  { label: "Notion 타임라인 (보조)", href: "/timeline", keywords: "notion timeline 미러", leadOnly: true, notionOnly: true },
];

const SECTIONS: { title: string; items: PaletteItem[] }[] = [
  { title: "이동", items: NAV_ITEMS },
  { title: "만들기", items: CREATE_ITEMS },
  { title: "관리", items: ADMIN_ITEMS },
];

export default function CommandPalette({ role, notionConnected = true }: { role: Role; notionConnected?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [creating, setCreating] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // 통합 검색 — 220ms 디바운스. 열릴 때는 질의 없이 한 번 호출해 최근 항목을 채운다.
  useEffect(() => {
    if (!open) { setHits([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => { setHits(d.hits ?? []); setRecent(!!d.recent); })
        .catch(() => {});
    }, q.trim() ? 220 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  // ⌘K 빠른 생성 — 입력한 텍스트를 제목으로 업무 즉시 생성(영역은 서버 기본값), 후 상세 패널 열기
  const quickTitle = q.trim();

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SECTIONS.map(({ title, items }) => ({
      title,
      items: items.filter((item) => {
        if (item.leadOnly && role !== "lead") return false;
        if (item.notionOnly && !notionConnected) return false;
        if (!needle) return true;
        return (item.label + " " + item.keywords).toLowerCase().includes(needle);
      }),
    })).filter((section) => section.items.length > 0);
  }, [q, role, notionConnected]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setSel(0);
  }, []);

  useEffect(() => {
    // ⌘K 자체는 전역 단축키 레이어(Shortcuts)가 소유한다 — 여기서는 신호만 받는다.
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    function onOpen() {
      setOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("tb:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("tb:open-palette", onOpen);
    };
  }, [close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setSel(0);
  }, [q]);

  /** 검색 결과 열기 — 프로젝트만 화면 이동, 나머지는 전역 패널(§B). */
  const openHit = useCallback((h: SearchHit) => {
    close();
    if (h.kind === "project") { router.push(`/projects/${h.id}`); return; }
    if (h.kind === "task") { openTaskPanel(h.id); return; }
    openPanel(h.kind === "person" ? "member" : "decision", h.id);
  }, [close, router]);

  function go(item: PaletteItem) {
    if (item.quick) {
      setOpen(false);
      openQuickCreate({ x: window.innerWidth / 2 - 160, y: 150 });
      return;
    }
    close();
    router.push(item.href);
  }

  const createQuickTask = useCallback(async () => {
    const title = quickTitle;
    if (!title || creating) return;
    setCreating(true);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }), // 영역은 서버 기본값 배치 (본인 소속 영역 우선)
    });
    setCreating(false);
    if (!res.ok) return;
    const { id } = await res.json();
    close();
    notifyTaskUpdated();
    openTaskPanel(id);
  }, [quickTitle, creating, close]);

  // 순서 = 검색 결과 → 이동/만들기/관리 → 빠른 생성(맨 끝).
  // ⌘K의 1순위는 "빠른 이동"이므로 생성 액션이 검색 결과를 밀어내지 않는다.
  const hasQuick = quickTitle.length > 0;
  const quickIndex = hits.length + flat.length;
  function onInputKey(event: React.KeyboardEvent) {
    const max = quickIndex - (hasQuick ? 0 : 1);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSel((v) => Math.min(v + 1, Math.max(max, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSel((v) => Math.max(v - 1, 0));
    } else if (event.key === "Enter") {
      if (sel < hits.length) { openHit(hits[sel]); return; }
      const item = flat[sel - hits.length];
      if (item) { go(item); return; }
      if (hasQuick) createQuickTask();
    }
  }

  if (!open) return null;

  let index = hits.length - 1;
  return (
    <div className={`ovl on`} onClick={close}>
      <div className="pal" role="dialog" aria-label="빠른 이동" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          placeholder="프로젝트·업무·사람·결정 검색, 또는 이동할 곳"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onInputKey}
        />
        <div className="list">
          {hits.length > 0 && (
            <div>
              <div className="sec">{recent ? "최근" : "검색 결과"}</div>
              {hits.map((h, i) => (
                  <div key={`${h.kind}${h.id}`} className={`it ${i === sel ? "sel" : ""}`}
                    onMouseEnter={() => setSel(i)} onClick={() => openHit(h)}>
                    <span className={`pal-k pal-${h.kind}`}>{HIT_LABEL[h.kind]}</span>
                    <span className="pal-t">{h.title}</span>
                    <span className="k">{h.meta}</span>
                  </div>
              ))}
            </div>
          )}
          {flat.length === 0 && hits.length === 0 && !hasQuick && <div className="empty">일치하는 항목이 없습니다</div>}
          {sections.map((section) => (
            <div key={section.title}>
              <div className="sec">{section.title}</div>
              {section.items.map((item) => {
                index += 1;
                const i = index;
                return (
                  <div
                    key={item.href + item.label}
                    className={`it ${i === sel ? "sel" : ""}`}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(item)}
                  >
                    {item.label}
                    <span className="k">{item.href.split("?")[0]}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {hasQuick && (
            <div>
              <div className="sec">빠른 생성</div>
              <div
                className={`it ${sel === quickIndex ? "sel" : ""}`}
                onMouseEnter={() => setSel(quickIndex)}
                onClick={createQuickTask}
              >
                {creating ? "만드는 중…" : `＋ 새 업무: “${quickTitle}”`}
                <span className="k">enter</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

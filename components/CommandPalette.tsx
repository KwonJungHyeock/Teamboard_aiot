"use client";

// 커맨드 팔레트 (Phase 2) — ⌘K / Ctrl+K.
// 항목은 아래 배열에만 등록하면 된다 (신규 화면 추가 시 이 파일의 배열만 수정).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/types";

interface PaletteItem {
  label: string;
  href: string;
  keywords: string; // 검색 보조어 (영문·초성 등)
  leadOnly?: boolean;
}

// ── 이동 ──
const NAV_ITEMS: PaletteItem[] = [
  { label: "홈", href: "/", keywords: "home dashboard 대시보드" },
  { label: "내 업무", href: "/tasks", keywords: "task 업무 할일 todo" },
  { label: "캘린더", href: "/calendar", keywords: "calendar 일정 스케줄" },
  { label: "내 부사수", href: "/assistant", keywords: "assistant agent ai 에이전트" },
  { label: "목표", href: "/goals", keywords: "goal okr 연간 분기 월" },
  { label: "월간 보고", href: "/reports", keywords: "report 보고서 월말", leadOnly: true },
  { label: "시그널", href: "/signals", keywords: "signal 결정 리뷰 메모 리스크" },
  { label: "허들", href: "/huddle", keywords: "huddle 공유 코멘트" },
];

// ── 만들기 ──
const CREATE_ITEMS: PaletteItem[] = [
  { label: "부사수에게 업무 위임", href: "/assistant", keywords: "위임 초안 draft delegate" },
  { label: "업무 만들기", href: "/tasks?new=1", keywords: "task new 새 업무" },
  { label: "시그널 올리기", href: "/signals?new=1", keywords: "signal new 결정 요청" },
];

// ── 관리 (lead 전용) ──
const ADMIN_ITEMS: PaletteItem[] = [
  { label: "구성원 관리", href: "/members", keywords: "member 계정 발급", leadOnly: true },
  { label: "설정", href: "/settings", keywords: "settings notion 연동", leadOnly: true },
  { label: "Notion 타임라인 (보조)", href: "/timeline", keywords: "notion timeline 미러", leadOnly: true },
];

const SECTIONS: { title: string; items: PaletteItem[] }[] = [
  { title: "이동", items: NAV_ITEMS },
  { title: "만들기", items: CREATE_ITEMS },
  { title: "관리", items: ADMIN_ITEMS },
];

export default function CommandPalette({ role }: { role: Role }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SECTIONS.map(({ title, items }) => ({
      title,
      items: items.filter((item) => {
        if (item.leadOnly && role !== "lead") return false;
        if (!needle) return true;
        return (item.label + " " + item.keywords).toLowerCase().includes(needle);
      }),
    })).filter((section) => section.items.length > 0);
  }, [q, role]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setSel(0);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      } else if (event.key === "Escape") {
        close();
      }
    }
    function onOpen() {
      setOpen(true);
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

  function go(item: PaletteItem) {
    close();
    router.push(item.href);
  }

  function onInputKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSel((v) => Math.min(v + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSel((v) => Math.max(v - 1, 0));
    } else if (event.key === "Enter" && flat[sel]) {
      go(flat[sel]);
    }
  }

  if (!open) return null;

  let index = -1;
  return (
    <div className={`ovl on`} onClick={close}>
      <div className="pal" role="dialog" aria-label="빠른 이동" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          placeholder="이동할 곳이나 실행할 작업을 입력하세요"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onInputKey}
        />
        <div className="list">
          {flat.length === 0 && <div className="empty">일치하는 항목이 없습니다</div>}
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
        </div>
      </div>
    </div>
  );
}

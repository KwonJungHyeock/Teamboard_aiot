"use client";

// "+ 새로 만들기" 드롭다운 (파트 4 빠른 입력) — 업무/일정/시그널/메모.
// 업무는 상세 패널을 빈 상태로 연다. 나머지는 각 화면의 작성 폼으로 이동.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { openQuickCreate } from "@/lib/quick";

export default function NewMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="newmenu" ref={ref}>
      <button className="newbtn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        ＋ 새로 만들기
      </button>
      {open && (
        <div className="newmenu-pop" role="menu">
          <button role="menuitem" onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            pick(() => openQuickCreate({ x: r.left, y: r.bottom + 6 }));
          }}>
            <span className="nm-i">📋</span>
            <span className="nm-b"><b>업무</b><em>빠른 생성 팝오버</em></span>
          </button>
          <button role="menuitem" onClick={() => pick(() => router.push("/calendar"))}>
            <span className="nm-i">🗓️</span>
            <span className="nm-b"><b>일정</b><em>캘린더에서 기간 지정</em></span>
          </button>
          <button role="menuitem" onClick={() => pick(() => router.push("/signals"))}>
            <span className="nm-i">📡</span>
            <span className="nm-b"><b>논의·결정</b><em>결정·확인 요청·리스크</em></span>
          </button>
          <button role="menuitem" onClick={() => pick(() => router.push("/signals?type=memo"))}>
            <span className="nm-i">📝</span>
            <span className="nm-b"><b>메모</b><em>비공개 메모 남기기</em></span>
          </button>
        </div>
      )}
    </div>
  );
}

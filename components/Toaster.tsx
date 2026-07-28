"use client";

// 토스트 스택 (미세 피드백) — 전역 tb:toast 이벤트를 듣고 우하단에 잠깐 띄운다.
import { useEffect, useState } from "react";
import { TOAST_EVENT } from "@/lib/quick";

interface T { id: number; message: string; tone: "ok" | "err" }
let seq = 1;

export default function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as { message: string; tone?: "ok" | "err" };
      const id = seq++;
      setItems((prev) => [...prev, { id, message: d.message, tone: d.tone ?? "ok" }]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast t-${t.tone}`}>
          <span className="toast-dot" />
          {t.message}
        </div>
      ))}
    </div>
  );
}

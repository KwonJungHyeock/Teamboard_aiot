"use client";

// 토스트 스택 (미세 피드백) — 전역 tb:toast 이벤트를 듣고 우하단에 잠깐 띄운다.
import { useEffect, useState } from "react";
import { TOAST_EVENT } from "@/lib/quick";

interface ToastAction { label: string; onClick: () => void }
interface T { id: number; message: string; tone: "ok" | "err"; action?: ToastAction }
let seq = 1;

export default function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as { message: string; tone?: "ok" | "err"; action?: ToastAction };
      const id = seq++;
      setItems((prev) => [...prev, { id, message: d.message, tone: d.tone ?? "ok", action: d.action }]);
      // 실행취소가 붙은 토스트는 조금 더 오래 남긴다
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), d.action ? 6000 : 3200);
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
          {t.action && (
            <button className="toast-act" onClick={() => {
              t.action!.onClick();
              setItems((prev) => prev.filter((x) => x.id !== t.id));
            }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}

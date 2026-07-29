"use client";

// 전역 실시간 연동 — 업무 생성/수정/상태변경 시 서버 렌더 화면(홈 타임라인·캘린더 등)을
// router.refresh()로 재조회한다. 목록(클라이언트)은 각 뷰가 TASK_UPDATED로 직접 재로드하고,
// 여기서는 서버 컴포넌트 데이터(홈 요약·캘린더)를 갱신해 "끊김"을 없앤다. (짧게 디바운스)
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { TASK_UPDATED_EVENT } from "@/lib/task-panel";

export default function TaskSync() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const onUpd = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 120);
    };
    window.addEventListener(TASK_UPDATED_EVENT, onUpd);
    return () => {
      window.removeEventListener(TASK_UPDATED_EVENT, onUpd);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);
  return null;
}

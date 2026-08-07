"use client";

// 파일 첨부 UI 한 벌 (MD-P-2026-026 §B-2).
//
// 이관 전에는 첨부가 **여섯 곳에서 여섯 가지로** 생겼다.
//   · 버튼이 없고 붙여넣기만 되는 곳 (업무 설명·코멘트)
//   · 이모지 붙은 버튼 (논의 스레드 "🖼 이미지 첨부")
//   · 슬래시 명령만 있는 곳 (문서형 본문)
//   · 점선 드롭 영역이 보이는 유일한 곳 (리뷰 세션)
//   · 드롭은 되는데 **드롭할 수 있다는 표시가 없는** 곳 (프로젝트 캔버스·업무 설명)
// 업로드 중 표시도 "올리는 중…" · "이미지 업로드 중…" · "업로드 중…" 으로 제각각이었고,
// 실패는 토스트로 사라지거나 회색 한 줄로만 남아 **무엇이 왜 실패했는지** 알 수 없었다.
//
// §G 규격:
//   · 첨부 버튼 — `.btn-ghost` 치수, 이모지 없음, 문구는 "이미지 첨부" 하나
//   · 드롭 영역 — 드래그가 들어오면 테두리가 코랄로 바뀌고 문구가 뜬다. 평소에는 조용하다
//   · 업로드 중 — **스켈레톤 자리** (스피너 금지, §A-4 와 같은 규칙)
//   · 실패     — 무엇이 실패했는지(파일명) + 사유 + **다시 시도** (§A-5 와 같은 규칙)
import { useCallback, useRef, useState, type ReactNode } from "react";
import { uploadImage, type UploadScope, type UploadedImage } from "@/lib/upload";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/* ══════════════════ 상태 ══════════════════ */

export type AttachPhase =
  | { phase: "idle" }
  | { phase: "uploading"; name: string }
  | { phase: "error"; name: string; message: string };

/**
 * 업로드 한 건의 수명주기를 한 곳에서 관리한다.
 * 화면마다 uploading/err 상태를 따로 들고 있으면 표시가 반드시 갈린다.
 *
 * 실패한 파일은 `retry()` 로 **같은 파일을 다시 보낼 수 있게** 붙잡아 둔다.
 * 붙잡아 두지 않으면 "다시 시도" 는 파일을 다시 고르라는 말이 되고, 그건 다시 시도가 아니다.
 */
export function useAttach(scope: UploadScope, onDone: (up: UploadedImage, file: File) => void | Promise<void>) {
  const [state, setState] = useState<AttachPhase>({ phase: "idle" });
  const lastFile = useRef<File | null>(null);

  const send = useCallback(async (file: File) => {
    lastFile.current = file;
    setState({ phase: "uploading", name: file.name });
    try {
      const up = await uploadImage(file, scope);
      await onDone(up, file);
      setState({ phase: "idle" });
    } catch (e) {
      setState({ phase: "error", name: file.name, message: e instanceof Error ? e.message : "이미지 업로드 실패" });
    }
  }, [scope, onDone]);

  const retry = useCallback(() => { if (lastFile.current) void send(lastFile.current); }, [send]);
  const dismiss = useCallback(() => setState({ phase: "idle" }), []);

  return { state, send, retry, dismiss, busy: state.phase === "uploading" };
}

/* ══════════════════ 버튼 ══════════════════ */

export function AttachButton({
  onFile, busy = false, disabled = false, reason,
}: {
  onFile: (file: File) => void;
  busy?: boolean;
  disabled?: boolean;
  /** 못 쓰는 이유. 있으면 title 로 붙는다 — 비활성 버튼만 두고 이유를 안 적지 않는다. */
  reason?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className="btn-ghost"
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy || disabled}
        title={disabled ? reason : undefined}
      >
        이미지 첨부
      </button>
      <input
        ref={ref} type="file" accept={ACCEPT} hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";          // 같은 파일을 연달아 고를 수 있게 비운다
          if (f) onFile(f);
        }}
      />
    </>
  );
}

/* ══════════════════ 드롭 영역 ══════════════════ */

/**
 * 감싼 영역에 이미지를 끌어다 놓을 수 있게 한다.
 * **평소에는 아무 표시도 하지 않는다** — 늘 점선을 그려두면 화면이 시끄러워진다.
 * 드래그가 들어온 순간에만 테두리와 문구가 뜬다.
 */
export function DropZone({
  onFile, disabled = false, className = "", children, label = "여기에 놓으면 첨부됩니다",
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);   // dragenter/leave 는 자식마다 발생한다 — 깊이를 세야 깜빡이지 않는다

  if (disabled) return <div className={className}>{children}</div>;

  const pick = (list: FileList | null) =>
    Array.from(list ?? []).find((f) => f.type.startsWith("image/"));

  return (
    <div
      className={`dz${over ? " on" : ""} ${className}`}
      onDragEnter={(e) => { e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); }}
      onDrop={(e) => {
        e.preventDefault(); depth.current = 0; setOver(false);
        const f = pick(e.dataTransfer.files);
        if (f) onFile(f);
      }}
    >
      {children}
      {over && (
        <div className="dz-hint" aria-hidden="true">
          <span className="dz-hint-l">{label}</span>
        </div>
      )}
    </div>
  );
}

/* ══════════════════ 진행 · 실패 ══════════════════ */

/**
 * 업로드 중·실패 표시. `useAttach` 의 state 를 그대로 넘긴다.
 * idle 이면 아무것도 그리지 않는다.
 */
export function AttachStatus({
  state, onRetry, onDismiss,
}: {
  state: AttachPhase;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (state.phase === "idle") return null;

  if (state.phase === "uploading") {
    return (
      <div className="atc atc-up" role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">{state.name} 올리는 중</span>
        {/* 스켈레톤 자리 — 스피너를 쓰지 않는다 (§A-4 와 같은 규칙) */}
        <span className="atc-skel" aria-hidden="true" />
        <span className="atc-name">{state.name}</span>
      </div>
    );
  }

  return (
    <div className="atc atc-err" role="alert">
      <p>
        <b>{state.name}</b> 을(를) 올리지 못했어요.
        <em> {state.message}</em>
      </p>
      <button className="err-retry" type="button" onClick={onRetry}>다시 시도</button>
      <button className="atc-x" type="button" onClick={onDismiss} aria-label="닫기">✕</button>
    </div>
  );
}

"use client";

// Private Blob 이미지 표시 (MD-P-2026-014a §C).
// src 는 언제나 /api/blob 라우트다. blob 원본 URL(*.private.blob.vercel-storage.com)을 쓰지 않는다.
// 실패하면 깨진 이미지 대신 사유 + [다시 시도] 를 보여준다.
// 썸네일·라이트박스가 같은 경로를 쓴다 — 두 벌로 만들지 않는다.
import { useEffect, useState } from "react";
import { imageSrc } from "@/lib/upload";

export default function BlobImage({
  value, alt = "", className, zoomable = true, name,
}: {
  /** pathname (신규) 또는 http URL (014a 이전 데이터) */
  value: string;
  alt?: string;
  className?: string;
  zoomable?: boolean;
  /** 원본 파일명 — 실패 안내에 쓴다 */
  name?: string;
}) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<"load" | "ok" | "err">("load");
  const [zoom, setZoom] = useState(false);

  useEffect(() => { setState("load"); }, [value, nonce]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const src = `${imageSrc(value)}${nonce ? (imageSrc(value).includes("?") ? "&" : "?") + "r=" + nonce : ""}`;

  if (state === "err") {
    return (
      <div className={`bimg-err${className ? " " + className : ""}`} role="status">
        <p>이미지를 불러오지 못했습니다{name ? ` — ${name}` : ""}.</p>
        <p className="bimg-err-sub">권한이 없거나 파일이 삭제됐을 수 있습니다.</p>
        <button className="btn-ghost" onClick={() => setNonce((n) => n + 1)}>다시 시도</button>
      </div>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={`bimg${state === "load" ? " loading" : ""}${zoomable ? " zoomable" : ""}${className ? " " + className : ""}`}
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setState("ok")}
        onError={() => setState("err")}
        onClick={zoomable ? () => setZoom(true) : undefined}
      />
      {zoom && (
        <div className="bimg-zoom" role="dialog" aria-label="이미지 확대" onClick={() => setZoom(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} />
        </div>
      )}
    </>
  );
}

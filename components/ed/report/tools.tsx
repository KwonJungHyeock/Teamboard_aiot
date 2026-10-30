"use client";

// 팀 보고 화면 도구 — 페이지 맞춤(1600×900 → 화면 폭) · 파일 올리기 · PDF 만들기.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fileUrl, type PageDef, type ReportData } from "./Pages";

export const PAGE_W = 1600, PAGE_H = 900;

/** 1600×900 페이지를 감싼 상자 폭에 맞춰 줄인다 */
export function Fit({ children, className, onClick, fitHeight }: { children: ReactNode; className?: string; onClick?: () => void; fitHeight?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const on = () => setK(fitHeight ? Math.min(window.innerWidth / PAGE_W, window.innerHeight / PAGE_H) : el.clientWidth / PAGE_W);
    on();
    const ro = new ResizeObserver(on); ro.observe(el); window.addEventListener("resize", on);
    return () => { ro.disconnect(); window.removeEventListener("resize", on); };
  }, [fitHeight]);
  const style = fitHeight ? { width: PAGE_W * k, height: PAGE_H * k, aspectRatio: "auto" } : undefined;
  return (
    <div ref={box} className={`rp-fit${className ? ` ${className}` : ""}`} style={style} onClick={onClick}>
      <div style={{ transform: `scale(${k || 0.0001})`, transformOrigin: "0 0", position: "absolute", left: 0, top: 0 }}>{children}</div>
    </div>
  );
}

// ── 파일 올리기 ──────────────────────────────────────────────────
const KIND_OF: Record<string, "image" | "gif" | "video" | "pdf"> = {
  "image/png": "image", "image/jpeg": "image", "image/webp": "image", "image/gif": "gif",
  "video/mp4": "video", "video/webm": "video", "video/quicktime": "video", "application/pdf": "pdf",
};
const MB = 1024 * 1024;
export const kindOfFile = (f: File | Blob) => KIND_OF[f.type];
export function sizeError(f: File | Blob): string | null {
  const k = kindOfFile(f);
  if (!k) return "이미지(png · jpg · webp) · GIF · 영상(mp4 · webm · mov)만 올립니다.";
  const max = k === "image" ? 5 * MB : 50 * MB;
  return f.size > max ? `${k === "image" ? "이미지는 5MB" : "GIF · 영상은 50MB"}까지 올립니다.` : null;
}
const safe = (n: string) => (n.split(/[/\\]/).pop() ?? "file").replace(/[^\w.\-가-힣 ]/g, "_").replace(/\s+/g, "_").slice(0, 80) || "file";

/** 보고 파일 하나를 올리고 저장 경로를 돌려준다 — 운영은 Blob 직접, 로컬 개발은 임시 폴더 */
export async function uploadReportFile(reportId: number, file: File | Blob, name: string): Promise<string> {
  const mode = (await (await fetch("/api/team-reports/upload", { cache: "no-store" })).json()).mode as string;
  if (mode === "local") {
    const r = await fetch(`/api/team-reports/upload-local?report=${reportId}&name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": file.type }, body: file });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ?? "올리지 못했습니다");
    return d.pathname;
  }
  if (mode !== "blob") throw new Error("파일 저장소가 연결되지 않았습니다. 관리자에게 Vercel Blob 연결을 요청하세요.");
  const { upload } = await import("@vercel/blob/client");
  const pathname = `reports/${reportId}/${crypto.randomUUID()}-${safe(name)}`;
  const res = await upload(pathname, file, { access: "private", handleUploadUrl: "/api/team-reports/upload", clientPayload: JSON.stringify({ type: file.type }), contentType: file.type } as never);
  return (res as { pathname: string }).pathname;
}

// ── PDF ──────────────────────────────────────────────────────────
/** 영상의 첫 프레임 — PDF 에는 움직이는 것이 못 들어간다 */
async function posterOf(src: string): Promise<string | null> {
  return new Promise((ok) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = src; v.crossOrigin = "anonymous";
    const done = (x: string | null) => { v.removeAttribute("src"); v.load(); ok(x); };
    const t = setTimeout(() => done(null), 8000);
    v.addEventListener("loadeddata", () => { v.currentTime = Math.min(0.1, v.duration || 0); }, { once: true });
    v.addEventListener("seeked", () => {
      clearTimeout(t);
      try {
        const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext("2d")!.drawImage(v, 0, 0); done(c.toDataURL("image/jpeg", 0.85));
      } catch { done(null); }
    }, { once: true });
    v.addEventListener("error", () => { clearTimeout(t); done(null); }, { once: true });
  });
}
export async function videoPosters(d: ReportData): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  for (const it of d.items) for (const a of it.assets) {
    if (a.kind === "video" && a.path) { const p = await posterOf(fileUrl(a.path)); if (p) out[a.id] = p; }
  }
  return out;
}

/** 화면에 그려 둔 페이지(.rp-page) 들을 차례로 이미지로 떠서 16:9 PDF 로 묶는다 */
export async function pagesToPdf(nodes: HTMLElement[], onStep?: (i: number, n: number) => void): Promise<Blob> {
  const [{ toJpeg }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [PAGE_W, PAGE_H], hotfixes: ["px_scaling"], compress: true });
  for (let i = 0; i < nodes.length; i++) {
    onStep?.(i + 1, nodes.length);
    const img = await toJpeg(nodes[i], { quality: 0.9, width: PAGE_W, height: PAGE_H, pixelRatio: 1.5, cacheBust: false });
    if (i > 0) pdf.addPage([PAGE_W, PAGE_H], "landscape");
    pdf.addImage(img, "JPEG", 0, 0, PAGE_W, PAGE_H);
  }
  return pdf.output("blob");
}
export const pdfName = (d: ReportData) => `${d.report.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "보고"}.pdf`;
export function saveBlob(b: Blob, name: string) {
  const url = URL.createObjectURL(b);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export type { PageDef };

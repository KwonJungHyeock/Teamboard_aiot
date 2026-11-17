// 회의 자료 올리기 — 화면 쪽. 운영은 저장소로 바로(50MB), 로컬 개발은 개발 서버 임시 폴더로.
// 형식을 모르는 파일(한글 · 일부 오피스)은 확장자로 형식을 붙인다 — 서버가 형식으로 거른다.
const BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf",
  txt: "text/plain", csv: "text/csv", md: "text/markdown", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  hwp: "application/x-hwp", hwpx: "application/vnd.hancom.hwpx", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};
export const UPLOAD_MAX = 50 * 1024 * 1024;
const extOf = (n: string) => (n.split(".").pop() ?? "").toLowerCase();
export const typeOf = (f: File) => (f.type && f.type !== "application/octet-stream" ? f.type : BY_EXT[extOf(f.name)] ?? "");
const safe = (n: string) => n.replace(/[\\/\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

let mode: Promise<string> | null = null;
const modeOf = (id: number) => (mode ??= fetch(`/api/meetings/${id}/upload`, { cache: "no-store" }).then((r) => r.json()).then((d) => String(d.mode)).catch(() => { mode = null; return "none"; }));

/** 파일 하나를 회의 자료로 — 만든 항목 번호. 실패하면 사람이 읽을 문장으로 던진다 */
export async function uploadMeetingFile(meetingId: number, f: File): Promise<number> {
  const name = safe(f.name || "붙여넣은 이미지.png");
  const type = typeOf(f);
  if (!type) throw new Error(`「${name}」 — 올릴 수 없는 형식입니다`);
  if (f.size > UPLOAD_MAX) throw new Error(`「${name}」 — 50MB 이하만 올릴 수 있습니다`);
  const m = await modeOf(meetingId);
  const fail = async (r: Response) => { const d = await r.json().catch(() => null); throw new Error(d?.error ?? `「${name}」을(를) 올리지 못했습니다`); };
  if (m === "blob") {
    const { upload } = await import("@vercel/blob/client");
    const pathname = `meetings/${meetingId}/${crypto.randomUUID()}-${name}`;
    const res = await upload(pathname, f, { access: "private", handleUploadUrl: `/api/meetings/${meetingId}/upload`, clientPayload: JSON.stringify({ type }), contentType: type } as never);
    const r = await fetch(`/api/meetings/${meetingId}/files`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pathname: (res as { pathname: string }).pathname, name, size: f.size, mime: type }) });
    if (!r.ok) await fail(r);
    return (await r.json()).id;
  }
  if (m !== "local") throw new Error("파일 저장소가 연결되지 않았습니다. 관리자에게 Vercel Blob 연결을 요청하세요.");
  const r = await fetch(`/api/meetings/${meetingId}/files?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": type }, body: f });
  if (!r.ok) await fail(r);
  return (await r.json()).id;
}

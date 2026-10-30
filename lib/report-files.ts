// 보고 에셋 · PDF 파일 — 경로는 `reports/<보고 번호>/<uuid>-<이름>`.
//
// 운영(Vercel)은 Private Blob 이다. 50MB 영상을 함수 본문(4.5MB 한도)으로 받을 수 없어서 **브라우저가
// 저장소로 바로 올린다**(@vercel/blob/client upload → /api/team-reports/upload 가 토큰만 내준다).
// 저장소가 안 붙은 **로컬 개발**에서만 임시 폴더에 둔다 — 운영에서는 이 길이 막혀 있다.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { blobEnabled, safeName } from "./blob";

export const IMAGE_MAX = 5 * 1024 * 1024;
export const MEDIA_MAX = 50 * 1024 * 1024;   // GIF · 영상 · PDF
export const REPORT_TYPES: Record<string, "image" | "gif" | "video" | "pdf"> = {
  "image/png": "image", "image/jpeg": "image", "image/webp": "image",
  "image/gif": "gif", "video/mp4": "video", "video/webm": "video", "video/quicktime": "video", "application/pdf": "pdf",
};
export const maxFor = (type: string) => (REPORT_TYPES[type] === "image" ? IMAGE_MAX : MEDIA_MAX);

const PATH_RE = /^reports\/(\d+)\/[0-9a-f-]{36}-[^/]+$/i;
export const reportIdOfPath = (p: string): number | null => { const m = PATH_RE.exec(p); return m ? Number(m[1]) : null; };
export const newReportPath = (reportId: number, name: string) => `reports/${reportId}/${randomUUID()}-${safeName(name)}`;

export const localMode = () => !blobEnabled() && process.env.NODE_ENV !== "production";
const LOCAL_DIR = path.join(tmpdir(), "teamboard-report-files");
const localFile = (p: string) => path.join(LOCAL_DIR, p.replace(/\//g, "__"));
export async function putLocal(p: string, body: Buffer, type: string): Promise<void> {
  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(localFile(p), body);
  await writeFile(`${localFile(p)}.type`, type);
}
export async function readLocal(p: string): Promise<{ body: Buffer; type: string } | null> {
  try { return { body: await readFile(localFile(p)), type: (await readFile(`${localFile(p)}.type`, "utf8")).trim() }; }
  catch { return null; }
}

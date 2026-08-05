// 이미지 업로드 (클라이언트) — Private Blob 라우트 경유 (MD-P-2026-014a).
// 반환값은 공개 URL이 아니라 pathname 이다. 화면에는 blobSrc(pathname) 로 만든 라우트 경로를 쓴다.
export interface UploadedImage {
  pathname: string;
  name: string;
  size: number;
  contentType: string;
}

export type UploadScope = { kind: "project" | "task" | "review" | "signal"; id: number };

export async function uploadImage(file: File, scope: UploadScope): Promise<UploadedImage> {
  const qs = new URLSearchParams({ kind: scope.kind, id: String(scope.id), name: file.name || "image" });
  const res = await fetch(`/api/blob/upload?${qs}`, {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? (res.status === 404 ? "업로드 대상을 찾을 수 없습니다." : "이미지 업로드 실패"));
  }
  return (await res.json()) as UploadedImage;
}

/** 화면에서 쓰는 이미지 경로. blob 원본 URL은 절대 노출하지 않는다. */
export function blobSrc(pathname: string): string {
  return `/api/blob?pathname=${encodeURIComponent(pathname)}`;
}

/**
 * 예전에 저장된 공개 URL(http…)과 새 pathname 을 함께 다룬다.
 * MD-P-2026-014a 이전 데이터는 URL로 남아 있어 그대로 표시해야 한다.
 */
export function imageSrc(value: string): string {
  return /^https?:\/\//i.test(value) ? value : blobSrc(value);
}

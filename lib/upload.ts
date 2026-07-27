// 이미지 업로드 (클라이언트) — 붙여넣기/드롭/파일을 Vercel Blob 에 올리고 URL 반환.
// 리뷰 업로드 라우트를 공용으로 재사용(라우트가 blob 원칙·크기 제한 담당). Postgres blob 금지 원칙 유지.
export async function uploadImage(file: File): Promise<string> {
  const res = await fetch(`/api/review/upload?t=${Date.now()}`, {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "이미지 업로드 실패");
  return data.url as string;
}

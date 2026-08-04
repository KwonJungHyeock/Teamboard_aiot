// 구 경로 — /activity로 영구 이동 (MD-P-2026-006 §G). 북마크·기존 링크 보존용.
import { redirect } from "next/navigation";

export default function Page() {
  redirect("/activity");
}

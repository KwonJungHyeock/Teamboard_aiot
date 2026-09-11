"use client";

// 권한이 없어 밀려난 사람에게 **왜 밀려났는지** 적는다 (MD-P-2026-053 §B-31).
//
// ── 사라지지 않는다 ─────────────────────────────────────────────
//
// 잠깐 떴다 사라지는 알림은 **못 보면 없는 것과 같다.** 밀려난 사람은 화면이
// 바뀐 것부터 보느라 몇 초를 그냥 흘려보낸다. 그래서 닫기 전까지 서 있는다.
//
// ── 문장을 여기서 만들지 않는다 ─────────────────────────────────
//
// 이유는 `lib/denied.ts` 의 표에서 온다 — **막은 쪽이 낸 말**이다. 여기서
// 주소를 보고 지어내면 같은 상황을 두 화면이 다르게 설명하게 된다.
import { useRouter, useSearchParams } from "next/navigation";
import { DENIED_PARAM, deniedReason } from "@/lib/denied";

export default function DeniedNote() {
  const router = useRouter();
  const sp = useSearchParams();
  const reason = deniedReason(sp.toString());
  if (reason === null) return null;

  /** 닫으면 주소에서도 뺀다 — 안 빼면 새로고침마다 같은 말을 다시 읽는다. */
  const close = () => {
    const p = new URLSearchParams(sp.toString());
    p.delete(DENIED_PARAM);
    router.replace(p.toString() ? `?${p}` : "?", { scroll: false });
  };

  return (
    <div className="dnote" role="status">
      <span className="dnote-i" aria-hidden="true">!</span>
      <p className="dnote-t">{reason}</p>
      <button type="button" className="dnote-x" onClick={close} aria-label="닫기">×</button>
    </div>
  );
}

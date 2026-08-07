// 빈 상태 아이콘 존재 검사 (MD-P-2026-025 지시 29-4).
//
// EmptyState 가 참조하는 공용 선화가 실제로 있는지 **빌드 전에** 확인한다.
// 예전에는 파일이 없으면 onError 로 슬롯이 조용히 사라져
// 전 화면이 2요소로 돌아가는데도 아무도 몰랐다. 조용히 실패하지 않게 한다.
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "components", "EmptyState.tsx");
const DIR = path.join(process.cwd(), "public", "empty");

// EmptyState.tsx 의 EMPTY_ICONS 를 단일 소스로 읽는다 — 목록을 두 벌 두지 않는다.
const src = fs.readFileSync(SRC, "utf8");
const m = /export const EMPTY_ICONS = \[([^\]]+)\]/.exec(src);
if (!m) {
  console.error("[check-empty-icons] EmptyState.tsx 에서 EMPTY_ICONS 를 찾지 못했습니다.");
  process.exit(1);
}
const icons = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);

const missing = icons.filter((n) => !fs.existsSync(path.join(DIR, `${n}.svg`)));
if (missing.length > 0) {
  console.error(
    `[check-empty-icons] 빈 상태 아이콘이 없습니다: ${missing.map((n) => `public/empty/${n}.svg`).join(", ")}\n` +
    `  빈 상태는 §G 규격상 "설명 + CTA + 아이콘" 3요소입니다. 파일을 추가하거나 EMPTY_ICONS 에서 빼세요.`
  );
  process.exit(1);
}
console.log(`[check-empty-icons] 아이콘 ${icons.length}종 확인 — ${icons.join(", ")}`);

import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { UnknownPropertyTypeError } from "./notion-schema";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // Notion 속성 타입 미확정 — 스키마 새로고침 안내 (400)
  if (error instanceof UnknownPropertyTypeError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // DB 가드가 거부한 요청은 서버 장애가 아니라 잘못된 입력이다 → 409 (MD-P-2026-024 §2).
  // 대상: 업무 구조 트리거(깊이 2단·차단 순환·하위 있는 상위 삭제)가 던지는 예외.
  // 메시지가 사용자용 한국어인 우리 가드만 통과시키고, 그 외 제약 위반은 500 그대로 둔다.
  if (isTaskGuardViolation(error)) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
  /*
   * ── 061 §A-2 · 영역 ≠ 프로젝트 영역 ──────────────────────────────
   *
   * `trg_task_area_match` 는 영어 제약 문구를 던진다:
   *   task.area_id(1) must match project.area_id for project 1
   * 이 글자가 그대로 화면에 떴다. **읽는 사람이 할 수 있는 게 없는 문장**이고,
   * 게다가 500 이라 「서버가 고장났다」로 읽힌다. 값이 안 맞는 것이니 400 이다.
   *
   * 제약 자체는 **그대로 둔다**(§A-2 ⑤). 화면이 막는 건 편의고 제약이 막는 건
   * 보증이다. 편의가 생겼다고 보증을 떼지 않는다 — 화면을 안 거치는 길(API 직접
   * 호출 · 앞으로 생길 화면)이 늘 있다.
   */
  if (isAreaProjectMismatch(error)) {
    return NextResponse.json(
      { error: "고른 프로젝트가 고른 영역에 속하지 않습니다." }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  console.error("[api]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * `trg_task_area_match` 가 던진 예외인가 (061 §A-2).
 *
 * 제약 이름이 아니라 **문구로** 알아본다 — `RAISE EXCEPTION` 은 제약 이름을
 * 코드에 안 싣고, 트리거 예외는 `P0001`(raise_exception) 로 온다.
 */
function isAreaProjectMismatch(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /task\.area_id\(.*\) must match project\.area_id/.test(error.message);
}

/** 업무 구조 가드(0023 트리거)가 던진 예외인가 — 사용자 입력 문제이므로 409 로 돌린다. */
function isTaskGuardViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (code !== "23514" && code !== "23503") return false;   // check / foreign_key violation
  return /하위 업무|차단 관계|깊이 2단/.test(error.message);
}

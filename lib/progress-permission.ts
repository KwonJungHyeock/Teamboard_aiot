// 진척을 손으로 바꿀 수 있는가 — **판정이 사는 한 곳** (MD-P-2026-033 §B).
//
// **순수 함수다.** API 도 화면도 이 함수를 부른다. 두 벌이 되면 반드시 어긋나고,
// 어긋나는 방향이 「화면은 되는데 저장은 403」이라 제일 나쁜 모양이 된다.
//
// ── 막는 이유가 둘이다. 섞지 않는다 ──────────────────────────────
//
//   ① **권한** — 지정된 한 사람이 아니다
//   ② **규칙** — 하위 업무가 있으면 진척은 하위 완료율이다 (lib/progress.ts 규칙 2)
//
// ②는 권한과 무관하다. 지정된 사람이라도 못 바꾼다 — 바꿔 봐야 계산이 덮어쓴다.
// 그래서 「권한이 없습니다」로 뭉뚱그리지 않고 **이유를 따로 낸다.**
// 뭉뚱그리면 권한을 받은 사람이 「내 권한이 잘못됐나」를 의심하며 시간을 버린다.

export type ProgressBlockReason = "not-editor" | "auto-from-children" | "done-is-100";

export interface ProgressEditRight {
  canEdit: boolean;
  reason?: ProgressBlockReason;
  /** 화면에 그대로 띄울 수 있는 말. API 도 이것을 400/403 본문에 쓴다. */
  message?: string;
}

export interface ProgressEditSubject {
  /** 하위 업무 수. 1 이상이면 진척은 계산값이다. */
  childCount?: number | null;
  /**
   * 업무 상태. **넘기면** 완료 업무의 편집을 막는다.
   *
   * ── 왜 넘기는 쪽이 정하는가 (MD-P-2026-034 §C) ──────────────────
   *
   * 완료 업무의 진척은 이미 계산이 이긴다 — `taskProgress()` 가
   * `status === "done"` 이면 무조건 100 을 낸다. 그러니 손으로 바꿔도
   * 화면에는 100 으로 보이고, **바꿨는데 안 바뀐 것처럼 보인다.**
   * 화면은 그 사실을 미리 말하려고 상태를 넘긴다.
   *
   * **API 는 넘기지 않는다.** 넘기면 「완료된 업무의 진척을 못 바꾼다」는
   * 새 규칙이 생기고, 그건 이번에 만들기로 한 것이 아니다. 표시만 더한다.
   */
  status?: string | null;
}

export function canEditProgress(
  viewerId: number,
  editorActorId: number | null,
  task: ProgressEditSubject = {}
): ProgressEditRight {
  // 규칙을 권한보다 **먼저** 본다. 지정된 사람에게 「권한이 없다」고 말하면
  // 그 사람은 설정을 뒤지러 간다 — 설정에는 아무 문제가 없는데.
  if ((task.childCount ?? 0) > 0) {
    return {
      canEdit: false,
      reason: "auto-from-children",
      message: "하위 업무가 있어 진척은 하위 완료율로 계산됩니다. 손으로 바꿀 수 없습니다.",
    };
  }
  // 완료 업무도 규칙이 이긴다 — 권한보다 먼저 본다(위와 같은 이유).
  if (task.status === "done") {
    return {
      canEdit: false,
      reason: "done-is-100",
      message: "완료 처리된 업무는 진척이 100 입니다. 상태를 되돌리면 바꿀 수 있습니다.",
    };
  }
  // 아무도 지정되지 않았으면 **아무도 못 바꾼다.** 「지정 안 했으니 전부 허용」이
  // 아니다 — 권한은 닫힌 쪽이 기본이다.
  if (editorActorId === null || viewerId !== editorActorId) {
    return {
      canEdit: false,
      reason: "not-editor",
      message: "진척은 지정된 담당자만 바꿀 수 있습니다.",
    };
  }
  return { canEdit: true };
}

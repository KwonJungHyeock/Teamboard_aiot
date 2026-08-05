// Private Blob 접근 권한 (MD-P-2026-014a §B).
//
// 판정 규칙 — 두 조건을 모두 만족해야 읽을 수 있다.
//   ① pathname 이 그 엔티티에 **실제로 붙어 있어야** 한다.
//      경로를 추측해도, 블록에서 지운 뒤에도 열리지 않는다.
//   ② 그 엔티티를 볼 권한이 있어야 한다.
//      (비공개 메모·리뷰 시그널은 기존 signalVisibilityClause 를 그대로 쓴다 — 판정 로직 중복 금지)
//
// 하나라도 어긋나면 호출부는 404 로 답한다. 403 을 쓰지 않는 이유는
// "그 파일이 존재한다"는 사실 자체를 노출하지 않기 위해서다.
import { queryOne } from "./db";
import { signalVisibilityClause } from "./signals";
import type { BlobScope } from "./blob";

/** blocks JSONB 안에 { pathname: ... } 를 가진 원소가 있는가 */
const HAS_PATH = `@> jsonb_build_array(jsonb_build_object('pathname', $2::text))`;

export async function canReadBlob(scope: BlobScope, pathname: string, viewerId: number): Promise<boolean> {
  switch (scope.kind) {
    case "project": {
      const row = await queryOne<{ ok: number }>(
        `SELECT 1 AS ok
           FROM project_canvas c
           JOIN project p ON p.id = c.project_id AND p.is_active = true
          WHERE c.project_id = $1 AND c.blocks ${HAS_PATH}`,
        [scope.id, pathname]
      );
      return !!row;
    }
    case "task": {
      const row = await queryOne<{ ok: number }>(
        `SELECT 1 AS ok FROM task t
          WHERE t.id = $1 AND t.is_active = true AND t.doc ${HAS_PATH}`,
        [scope.id, pathname]
      );
      return !!row;
    }
    case "signal": {
      // 시그널 본문 이미지 또는 그 스레드의 코멘트 이미지. 가시성은 기존 규칙 그대로.
      const row = await queryOne<{ ok: number }>(
        `SELECT 1 AS ok FROM signal s
          WHERE s.id = $1 AND s.is_active = true
            AND (s.image_url = $2
                 OR EXISTS (SELECT 1 FROM comment c WHERE c.signal_id = s.id AND c.image_url = $2))
            AND ${signalVisibilityClause("$3")}`,
        [scope.id, pathname, viewerId]
      );
      return !!row;
    }
    case "review": {
      // 리뷰 항목의 전/후 이미지 또는 그 항목에 달린 코멘트 이미지.
      const row = await queryOne<{ ok: number }>(
        `SELECT 1 AS ok FROM review_item ri
           JOIN review_session rs ON rs.id = ri.session_id AND rs.is_active = true
          WHERE ri.session_id = $1
            AND (ri.before_url = $2 OR ri.after_url = $2
                 OR EXISTS (SELECT 1 FROM comment c WHERE c.review_item_id = ri.id AND c.image_url = $2))`,
        [scope.id, pathname]
      );
      return !!row;
    }
    default:
      return false;
  }
}

/**
 * 업로드 권한 — 올릴 대상이 존재하고 살아 있어야 한다.
 * (읽기와 달리 "아직 붙어 있지 않은" 상태이므로 참조 확인은 하지 않는다)
 */
export async function canWriteBlob(scope: BlobScope, viewerId: number): Promise<boolean> {
  switch (scope.kind) {
    case "project": {
      const row = await queryOne<{ status: string }>(
        `SELECT status FROM project WHERE id = $1 AND is_active = true`, [scope.id]
      );
      return !!row && row.status !== "archived";   // 보관 프로젝트는 읽기 전용
    }
    case "task": {
      const row = await queryOne<{ ok: number }>(
        `SELECT 1 AS ok FROM task WHERE id = $1 AND is_active = true`, [scope.id]
      );
      return !!row;
    }
    case "signal": {
      const row = await queryOne<{ ok: number }>(
        `SELECT 1 AS ok FROM signal s WHERE s.id = $1 AND s.is_active = true AND ${signalVisibilityClause("$2")}`,
        [scope.id, viewerId]
      );
      return !!row;
    }
    case "review": {
      const row = await queryOne<{ ok: number }>(
        `SELECT 1 AS ok FROM review_session WHERE id = $1 AND is_active = true`, [scope.id]
      );
      return !!row;
    }
    default:
      return false;
  }
}

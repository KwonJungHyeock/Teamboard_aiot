import { query } from "./db";
import { visibleTaskSql } from "./visibility";
import type { ActivityEntry } from "./types";

export async function logActivity(params: {
  userId?: number | null;
  assistantId?: number | null;
  message: string;
  level?: "info" | "success" | "warn" | "error";
  taskId?: number | null; // 상세 패널 활동 타임라인용 (해당 업무에 귀속)
}): Promise<void> {
  await query(
    `INSERT INTO activity_log (user_id, assistant_id, message, level, task_id) VALUES ($1, $2, $3, $4, $5)`,
    [params.userId ?? null, params.assistantId ?? null, params.message, params.level ?? "info", params.taskId ?? null]
  );
}

/**
 * @param userId    지정하면 그 사람의 로그만 (내 활동 탭)
 * @param viewerId  전체 보기(userId 없음)일 때 **보는 사람**. 개인 업무 줄을 거르는 데 쓴다.
 */
export async function recentActivity(
  limit = 30,
  userId?: number,
  viewerId?: number
): Promise<ActivityEntry[]> {
  if (userId) {
    return query<ActivityEntry>(
      `SELECT a.*, u.display_name AS user_name FROM activity_log a
       LEFT JOIN actor u ON u.id = a.user_id
       WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT $2`,
      [userId, limit]
    );
  }
  // ③ 팀 활동 로그 — 남의 개인 업무에 달린 줄은 뺀다 (MD-P-2026-025 §A3).
  //    로그 문구에 업무 제목이 들어가므로 줄이 남으면 제목이 그대로 샌다.
  //    viewer 를 모르는 호출(내부 도구 등)은 개인 업무 줄을 전부 뺀다 — 안전한 쪽으로.
  return query<ActivityEntry>(
    `SELECT a.*, u.display_name AS user_name FROM activity_log a
     LEFT JOIN actor u ON u.id = a.user_id
     LEFT JOIN task t ON t.id = a.task_id
     WHERE t.id IS NULL OR ${viewerId === undefined ? "t.visibility = 'team'" : visibleTaskSql("$2")}
     ORDER BY a.created_at DESC LIMIT $1`,
    viewerId === undefined ? [limit] : [limit, viewerId]
  );
}

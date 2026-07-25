import { query } from "./db";
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

export async function recentActivity(limit = 30, userId?: number): Promise<ActivityEntry[]> {
  if (userId) {
    return query<ActivityEntry>(
      `SELECT a.*, u.display_name AS user_name FROM activity_log a
       LEFT JOIN actor u ON u.id = a.user_id
       WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT $2`,
      [userId, limit]
    );
  }
  return query<ActivityEntry>(
    `SELECT a.*, u.display_name AS user_name FROM activity_log a
     LEFT JOIN actor u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT $1`,
    [limit]
  );
}

// 관제뷰 요약 (화면 C, 팀장 전용) — 4요소: 실시간 현황 / 막힌 곳 / 프로젝트 진행률 / 마감 임박
import { NextResponse } from "next/server";
import { requireLead } from "@/lib/auth";
import { query } from "@/lib/db";
import { queryTimeline } from "@/lib/notion";
import { recentActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import type { Draft, TimelineItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    requireLead();

    const [members, workingDrafts, pendingDrafts, activity] = await Promise.all([
      query<{ id: number; name: string; role: string; assistant_name: string }>(
        `SELECT u.id, u.name, u.role, a.name AS assistant_name
         FROM users u JOIN assistants a ON a.user_id = u.id
         ORDER BY u.id`
      ),
      query<Draft & { user_name: string; assistant_name: string }>(
        `SELECT d.*, u.name AS user_name, a.name AS assistant_name
         FROM drafts d JOIN users u ON u.id = d.user_id JOIN assistants a ON a.id = d.assistant_id
         WHERE d.status = 'working' ORDER BY d.created_at DESC`
      ),
      query<Draft & { user_name: string; assistant_name: string }>(
        `SELECT d.*, u.name AS user_name, a.name AS assistant_name
         FROM drafts d JOIN users u ON u.id = d.user_id JOIN assistants a ON a.id = d.assistant_id
         WHERE d.status = 'pending' ORDER BY d.created_at ASC`
      ),
      recentActivity(20),
    ]);

    // Notion 타임라인 실패는 관제뷰 전체를 막지 않는다
    let timeline: TimelineItem[] = [];
    let timelineError: string | null = null;
    try {
      timeline = await queryTimeline();
    } catch (error) {
      timelineError = error instanceof Error ? error.message : "Notion 조회 실패";
    }

    const today = new Date().toISOString().slice(0, 10);
    const weekLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 막힌 곳: 승인 대기 + 지연 업무(종료일 경과 & 미완료)
    const overdue = timeline.filter(
      (item) => item.endDate && item.endDate < today && item.status !== "완료"
    );
    // 마감 임박: 이번 주 내 종료일 & 미완료
    const dueSoon = timeline.filter(
      (item) =>
        item.endDate && item.endDate >= today && item.endDate <= weekLater && item.status !== "완료"
    );

    // 프로젝트별(업무 구분별) 진행률
    const progressMap = new Map<string, { total: number; done: number }>();
    for (const item of timeline) {
      const keys = item.areas.length ? item.areas : ["기타"];
      for (const key of keys) {
        const entry = progressMap.get(key) ?? { total: 0, done: 0 };
        entry.total += 1;
        if (item.status === "완료") entry.done += 1;
        progressMap.set(key, entry);
      }
    }
    const progress = Array.from(progressMap.entries())
      .map(([area, { total, done }]) => ({ area, total, done, percent: Math.round((done / total) * 100) }))
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({
      members,
      workingDrafts,
      pendingDrafts,
      overdue,
      dueSoon,
      progress,
      activity,
      timelineError,
    });
  } catch (error) {
    return jsonError(error);
  }
}

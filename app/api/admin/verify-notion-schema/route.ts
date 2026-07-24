// TEMPORARY — init-db 라우트와 함께 삭제. Notion DB 속성 허용값 대조.
// 코드가 보내는 값(lib/notion-schema)과 실제 Notion data source 선택지를 비교해
// 불일치를 목록으로 반환한다. 운영 첫날 승인 실패(선택지 없음)를 사전에 잡기 위함.
// 이중 잠금: ① ALLOW_DB_INIT === "true" 아니면 404 ② x-admin-secret 불일치 404.
// 토큰이 없으면 명확한 안내를 반환한다(실패가 아니라 준비 안내).
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getDataSourceSchema, getWorkspaceUsers } from "@/lib/notion";
import { NOTION_SELECT_PROPERTIES, NOTION_TIMELINE_SCHEMA, type NotionPropertySpec } from "@/lib/notion-schema";
import { logActivity } from "@/lib/activity";

// 로깅 실패가 잠금 응답 상태를 바꾸지 않도록 best-effort
async function safeLog(p: Parameters<typeof logActivity>[0]) {
  try { await logActivity(p); } catch { /* noop */ }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function secretMatches(given: string | null): boolean {
  const expected = process.env.AUTH_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function callerIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function GET(request: Request) {
  const ip = callerIp(request);

  // 잠금 ① — 존재 은폐
  if (process.env.ALLOW_DB_INIT !== "true") {
    await safeLog({ userId: null, message: `verify-notion-schema 차단 — ALLOW_DB_INIT 미설정 (IP: ${ip})`, level: "warn" });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // 잠금 ② — 시크릿
  if (!secretMatches(request.headers.get("x-admin-secret"))) {
    await safeLog({ userId: null, message: `verify-notion-schema 차단 — 시크릿 불일치 (IP: ${ip})`, level: "warn" });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 토큰 없으면 검증 불가 — 명확한 안내 (실패 아님)
  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json({
      ready: false,
      message:
        "NOTION_TOKEN이 아직 설정되지 않았습니다. 토큰 발급·등록 후 다시 호출하면 코드 허용값과 실제 Notion 선택지를 대조합니다.",
      codeExpectations: NOTION_SELECT_PROPERTIES.map((p) => ({ property: p.property, type: p.type, options: p.options })),
    });
  }

  try {
    const actual = await getDataSourceSchema();
    const mismatches: {
      property: string;
      issue: string;
      codeExpects?: string[];
      notionHas?: string[];
      missingInNotion?: string[];
    }[] = [];

    for (const spec of NOTION_SELECT_PROPERTIES) {
      const found = actual[spec.property];
      if (!found) {
        mismatches.push({ property: spec.property, issue: "Notion에 해당 속성이 없음", codeExpects: [...spec.options] });
        continue;
      }
      if (found.type !== spec.type) {
        mismatches.push({ property: spec.property, issue: `타입 불일치 (코드 ${spec.type} ≠ Notion ${found.type})` });
      }
      const missing = spec.options.filter((o) => !found.options.includes(o));
      if (missing.length > 0) {
        mismatches.push({
          property: spec.property,
          issue: "코드가 보내는 값 중 Notion 선택지에 없는 항목",
          missingInNotion: missing,
          notionHas: found.options,
        });
      }
    }

    // people/date/title 등 비선택 속성의 존재 여부도 확인
    const nonSelect = (Object.values(NOTION_TIMELINE_SCHEMA) as NotionPropertySpec[]).filter(
      (s) => !s.options
    );
    for (const spec of nonSelect) {
      if (!actual[spec.property]) {
        mismatches.push({ property: spec.property, issue: `Notion에 속성 없음 (타입 ${spec.type})` });
      }
    }

    // 담당자(people) 매핑 대조용 — 워크스페이스 사용자 목록 (init-db notion_user_id와 대조)
    let notionUsers: { id: string; name: string; type: string }[] = [];
    try {
      notionUsers = await getWorkspaceUsers();
    } catch {
      /* 사용자 목록 조회 실패는 치명 아님 */
    }

    await safeLog({
      userId: null,
      message: `verify-notion-schema 실행 — 불일치 ${mismatches.length}건 (IP: ${ip})`,
      level: "warn",
    });
    return NextResponse.json({ ready: true, ok: mismatches.length === 0, mismatches, notionUsers });
  } catch (error: any) {
    return NextResponse.json(
      { ready: true, ok: false, error: error?.message ?? "Notion 스키마 조회 실패" },
      { status: 502 }
    );
  }
}

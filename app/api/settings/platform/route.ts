// 플랫폼 설정 — 가오픈 시각 · 진척 편집자 (MD-P-2026-033).
//
// 팀장만 쓴다. 읽기는 팀장 화면에서만 부르므로 같은 게이트를 건다.
//
// ── 왜 마이그레이션이 없는가 ──────────────────────────────────────
// 값 둘 다 `config` 표의 행이다. 행이 없으면 코드가 기본값을 쓴다
// (`lib/platform-config.ts`). 설정값 하나 때문에 마이그레이션을 만들면
// **배포마다 도는 자동 러너에 실패할 자리를 하나 더 만드는 것**이고,
// 방금 그 자리에서 전면 장애를 겪었다.
import { NextResponse } from "next/server";
import { requireLead, requireLiveAdmin } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import {
  getPlatformOpen, setPlatformOpen, getProgressEditor, setProgressEditorId,
} from "@/lib/platform-config";
import { getUiV3, setUiV3 } from "@/lib/v3/switch";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireLead();
    const [open, editor, uiV3, people] = await Promise.all([
      getPlatformOpen(),
      getProgressEditor(),
      getUiV3(),
      query<{ id: number; display_name: string; is_active: boolean }>(
        `SELECT id, display_name, is_active FROM actor
          WHERE type = 'human' AND is_active = true ORDER BY id`
      ),
    ]);
    return NextResponse.json({
      open,
      editor,
      uiV3,
      people: people.map((p) => ({ id: p.id, name: p.display_name })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = requireLead();
    const body = (await request.json()) as {
      openAt?: string; progressEditorId?: number | null; uiV3?: boolean;
    };
    const changed: string[] = [];

    if (body.openAt !== undefined) {
      if (!Number.isFinite(Date.parse(body.openAt))) {
        return NextResponse.json({ error: "가오픈 날짜를 읽을 수 없습니다." }, { status: 400 });
      }
      const before = await getPlatformOpen();
      await setPlatformOpen(body.openAt);
      changed.push(`가오픈 ${before.openAt.slice(0, 10)} → ${body.openAt.slice(0, 10)}`);
    }

    if (body.progressEditorId !== undefined) {
      const id = body.progressEditorId;
      if (id !== null) {
        // **없는 사람·비활성 계정을 가리키게 두지 않는다.** 그러면 아무도 진척을
        // 못 바꾸는데 화면은 멀쩡해 보인다. 저장 시점에 막는 편이 싸다.
        const ok = await query<{ id: number }>(
          `SELECT id FROM actor WHERE id = $1 AND type = 'human' AND is_active = true`, [id]
        );
        if (ok.length === 0) {
          return NextResponse.json(
            { error: "활성 구성원만 지정할 수 있습니다." }, { status: 400 }
          );
        }
      }
      const before = await getProgressEditor();
      await setProgressEditorId(id);
      changed.push(`진척 편집자 ${before?.name ?? "없음"} → ${id === null ? "없음" : `#${id}`}`);
    }

    /*
     * ── v3 스위치 — **관리자만** (042 §B) ──────────────────────────
     *
     * 이 라우트의 나머지는 팀장까지다. 스위치만 관리자인 이유: 화면 하나를
     * 바꾸는 것이 아니라 **서비스 전체의 껍데기를 바꾼다.** 되돌리기가 쉬운
     * 것과 아무나 눌러도 되는 것은 다르다.
     *
     * 게이트를 **여기서** 건다 — 위쪽 `requireLead` 를 관리자로 올리면
     * 가오픈 날짜까지 관리자 전용이 되고, 그건 지시가 아니다.
     */
    if (body.uiV3 !== undefined) {
      if (typeof body.uiV3 !== "boolean") {
        return NextResponse.json({ error: "스위치 값이 올바르지 않습니다." }, { status: 400 });
      }
      await requireLiveAdmin();
      const before = await getUiV3();
      await setUiV3(body.uiV3);
      changed.push(`v3 화면 ${before ? "켜짐" : "꺼짐"} → ${body.uiV3 ? "켜짐" : "꺼짐"}`);
    }

    if (changed.length) {
      // 기록은 best-effort 다 — 설정은 이미 바뀌었고, 기록을 못 남긴다고
      // 저장을 실패로 되돌리면 사람은 같은 저장을 반복한다.
      try {
        await logActivity({
          userId: session.id, level: "info",
          message: `${session.name}이(가) 플랫폼 설정 변경 — ${changed.join(" · ")}`,
        });
      } catch (err) {
        console.error("[settings] 설정은 바뀌었으나 기록에 실패:",
          err instanceof Error ? err.message : String(err));
      }
    }

    const [open, editor, uiV3] = await Promise.all([
      getPlatformOpen(), getProgressEditor(), getUiV3(),
    ]);
    return NextResponse.json({ open, editor, uiV3 });
  } catch (error) {
    return jsonError(error);
  }
}

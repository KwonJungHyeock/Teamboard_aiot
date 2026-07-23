// 월간 보고 PPTX 생성 (Phase 9 E-5) — 고정 템플릿 6섹션 + 표지 (D-015: 자유 편집 없음).
// 입력은 report.content에 저장된 값(aggregate + narration) 그대로 — 화면과 동일 데이터.
// PPTX용 별도 집계 금지: 수치 불일치를 원천 차단한다.
import PptxGenJS from "pptxgenjs";
import type { MonthlyReportData } from "./report";

const BRAND_RED = "E31E24";
const DARK_BG = "14151A";
const TEXT_HI = "F2F3F5";
const TEXT_MID = "AEB2BC";
const TEXT_LO = "7C818C";
const LINE = "2A2C34";

const pct = (n: number | null) => (n === null ? "-" : `${n}%`);

/** 섹션 슬라이드 공통 레이아웃 — 제목 바 + 서술 + 불릿 (고정) */
function sectionSlide(
  pptx: PptxGenJS,
  index: number,
  title: string,
  prose: string | undefined,
  bullets: string[]
) {
  const s = pptx.addSlide();
  s.background = { color: DARK_BG };
  // 좌측 레드 인덱스 바
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 5.63, fill: { color: BRAND_RED } });
  s.addText(String(index), {
    x: 0.35, y: 0.3, w: 0.9, h: 0.9, fontSize: 40, bold: true, color: BRAND_RED, fontFace: "Arial",
  });
  s.addText(title, {
    x: 1.2, y: 0.42, w: 8.4, h: 0.7, fontSize: 24, bold: true, color: TEXT_HI, fontFace: "Arial",
  });
  s.addShape(pptx.ShapeType.line, { x: 1.2, y: 1.25, w: 8.4, h: 0, line: { color: LINE, width: 1 } });
  if (prose?.trim()) {
    s.addText(prose.trim(), {
      x: 1.2, y: 1.4, w: 8.4, h: 0.8, fontSize: 13, color: TEXT_MID, fontFace: "Arial", valign: "top",
    });
  }
  const bulletTop = prose?.trim() ? 2.3 : 1.5;
  s.addText(
    (bullets.length ? bullets : ["해당 사항 없음"]).map((t) => ({
      text: t,
      options: { bullet: { code: "2022" }, color: bullets.length ? TEXT_HI : TEXT_LO },
    })),
    { x: 1.2, y: bulletTop, w: 8.4, h: 5.63 - bulletTop - 0.3, fontSize: 13, fontFace: "Arial", lineSpacingMultiple: 1.3, valign: "top" }
  );
  s.addText("팀보드 월간 보고", { x: 1.2, y: 5.25, w: 6, h: 0.3, fontSize: 9, color: TEXT_LO, fontFace: "Arial" });
}

export async function buildReportPptx(
  data: MonthlyReportData,
  narration: Record<string, string>
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "TB", width: 10, height: 5.63 });
  pptx.layout = "TB";

  // ── 표지 (다크 + 브랜드 레드 솔리드) ──
  const cover = pptx.addSlide();
  cover.background = { color: DARK_BG };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 2.35, w: 10, h: 0.9, fill: { color: BRAND_RED } });
  cover.addText(`${data.periodLabel} 월간 보고`, {
    x: 0.6, y: 2.4, w: 8.8, h: 0.8, fontSize: 34, bold: true, color: "FFFFFF", fontFace: "Arial",
  });
  cover.addText("TEAMBOARD · 플랫폼사업팀", {
    x: 0.6, y: 1.7, w: 8.8, h: 0.5, fontSize: 14, color: TEXT_MID, fontFace: "Arial", charSpacing: 3,
  });
  cover.addText(
    [
      { text: `완료 ${data.completed.length}`, options: { color: TEXT_HI } },
      { text: "   ·   ", options: { color: TEXT_LO } },
      { text: `미달 ${data.incomplete.length + data.dropped.length}`, options: { color: TEXT_HI } },
      { text: "   ·   ", options: { color: TEXT_LO } },
      { text: `결정 ${data.decisions.length}`, options: { color: TEXT_HI } },
      { text: "   ·   ", options: { color: TEXT_LO } },
      { text: `리스크 ${data.risks.length}`, options: { color: TEXT_HI } },
    ],
    { x: 0.6, y: 3.5, w: 8.8, h: 0.5, fontSize: 13, fontFace: "Arial" }
  );

  // ── 1. 이번 달 목표 달성 현황 ──
  sectionSlide(
    pptx, 1, "이번 달 목표 달성 현황", narration.goals,
    data.goals.map((g) => `${g.title}: ${pct(g.progress)}${g.droppedCount > 0 ? ` (중단 ${g.droppedCount}건)` : ""}`)
  );

  // ── 2. 주요 수행 실적 ──
  sectionSlide(
    pptx, 2, "주요 수행 실적", narration.completed,
    data.completed.map((t) => `${t.title}${t.goalTitles.length ? ` [${t.goalTitles.join(", ")}]` : ""}${t.assigneeName ? ` — ${t.assigneeName}` : ""}`)
  );

  // ── 3. 미달 항목 및 사유 ──
  sectionSlide(
    pptx, 3, "미달 항목 및 사유", narration.incomplete,
    [
      ...data.incomplete.map((t) => `(미완료) ${t.title}${t.dueDate ? ` — 기한 ${t.dueDate}` : ""}`),
      ...data.dropped.map((t) => `(중단) ${t.title} — ${t.dropReason ?? "사유 미기재"}`),
    ]
  );

  // ── 4. 주요 결정 사항 (미실행 결정 병기) ──
  sectionSlide(
    pptx, 4, "주요 결정 사항", narration.decisions,
    [
      ...data.decisions.map((s) => `${s.title}${s.status === "resolved" ? " (반영됨)" : " (결정됨)"}`),
      ...(data.pendingDecisions.length
        ? ["— 미실행 결정 —", ...data.pendingDecisions.map((s) => `${s.title}${s.decidedAt ? ` (${s.decidedAt.slice(0, 10)} 결정${s.decidedElapsedDays != null ? `, 월말 기준 ${s.decidedElapsedDays}일 경과` : ""})` : ""}`)]
        : []),
    ]
  );

  // ── 5. 리스크 및 이슈 ──
  sectionSlide(
    pptx, 5, "리스크 및 이슈", narration.risks,
    data.risks.map((s) => `${s.title} (${s.status})`)
  );

  // ── 6. 다음 달 목표 및 계획 ──
  sectionSlide(
    pptx, 6, "다음 달 목표 및 계획", narration.next,
    [
      ...(data.nextGoals.length
        ? data.nextGoals.map((g) => `(목표) ${g.title}`)
        : ["다음 달 목표가 아직 설정되지 않았습니다."]),
      ...data.nextTasks.map((t) => `(예정) ${t.title}${t.dueDate ? ` — ${t.dueDate}` : ""}`),
    ]
  );

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return out;
}

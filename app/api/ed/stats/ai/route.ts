// 성과 분석 · AI 분석 카드 — **집계 숫자만** Claude 에 보낸다(업무 제목 · 이름 없음).
// 같은 날 같은 달은 한 번만 묻는다(config `stats_ai:{month}:{date}`). 키가 없으면 숫자로 만든 데모 문장.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { kstToday } from "@/lib/home";
import { query, queryOne } from "@/lib/db";
import { completeText, isDemoMode } from "@/lib/llm";
import { getStats, statsFacts, type StatsData } from "@/lib/ed/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ai { expect: string; cause: string; suggest: string; demo?: boolean }

const SYSTEM = `당신은 「AI 로봇 플랫폼팀」 팀장에게 업무 집계를 읽어 주는 분석가입니다.
주어진 JSON 숫자만 근거로 세 문장을 씁니다. 숫자에 없는 사실 · 사람 · 업무를 지어내지 않습니다.
- expect: 지금 속도대로면 가오픈 때 어떻게 되는지(숫자 포함) 한 문장
- cause: 그렇게 된 가장 큰 이유 한 문장(구간별 완료 · 지연 쏠림 · 부하에서)
- suggest: 팀장이 이번 주에 할 수 있는 일 한 문장
각 문장은 45자 안팎, 「~요」 말투. 출력은 JSON 하나만: {"expect":"…","cause":"…","suggest":"…"}`;

function demo(s: StatsData): Ai {
  const f = statsFacts(s);
  const seg = f.구간별_완료;
  return {
    demo: true,
    expect: f.남은_업무 === 0 ? "가오픈 대상 업무를 모두 끝냈어요." : `지금 속도(하루 ${f.하루_완료_속도.toFixed(1)}건)면 가오픈 때 약 ${f.지금_속도면_가오픈때_남음}건이 남아요.`,
    cause: seg.최근 < seg.앞 ? "최근 구간에 완료가 줄며 계획과 차이가 벌어졌어요." : f.계획_대비_차이 > 0 ? `계획보다 ${f.계획_대비_차이}건 뒤처져 있어요.` : "계획한 속도를 지키고 있어요.",
    suggest: f.지연_최다_한사람_건수 >= 3 ? `지연 ${f.지연_최다_한사람_건수}건이 한 사람에게 몰려 있어요. 나누면 남는 업무를 줄일 수 있어요.`
      : f.필요_속도 > f.하루_완료_속도 ? `하루 ${f.필요_속도.toFixed(1)}건이 필요해요. 기한 없는 일을 뒤로 미뤄 보세요.` : "지금 속도를 유지하면 돼요.",
  };
}

export async function GET(request: Request) {
  try {
    const s = requireSession();
    if (!hasLead(s.role) && !s.adminGrant) return NextResponse.json({ error: "팀장만 볼 수 있습니다." }, { status: 403 });
    const today = kstToday();
    const m = new URL(request.url).searchParams.get("month") ?? "";
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : today.slice(0, 7);
    const stats = await getStats(s.id, month, today);
    if (isDemoMode()) return NextResponse.json(demo(stats));
    const key = `stats_ai:${month}:${today}`;
    const hit = await queryOne<{ value: Ai }>(`SELECT value FROM config WHERE key = $1`, [key]);
    if (hit?.value?.expect) return NextResponse.json(hit.value);
    let ai: Ai;
    try {
      const raw = await completeText(SYSTEM, `달: ${month}\n오늘: ${today}\n집계(JSON):\n${JSON.stringify(statsFacts(stats))}`);
      const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      ai = { expect: String(j.expect ?? "").slice(0, 160), cause: String(j.cause ?? "").slice(0, 160), suggest: String(j.suggest ?? "").slice(0, 160) };
      if (!ai.expect) throw new Error("빈 응답");
    } catch (e) {
      console.error("[stats-ai]", e);
      return NextResponse.json(demo(stats));
    }
    await query(`INSERT INTO config (key, value, updated_by) VALUES ($1, $2, $3)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(ai), s.id]);
    return NextResponse.json(ai);
  } catch (error) { return jsonError(error); }
}

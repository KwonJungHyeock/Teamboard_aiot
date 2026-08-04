"use client";

// 월별 성과 리포트 (MD-P-2026-010) — 미리보기 = 출력물(WYSIWYG).
// 화면에 보이는 .prep 블록이 그대로 인쇄된다. 컨트롤 바·사이드바·FAB은 @media print에서 사라진다.
// 서버 PDF 렌더링은 쓰지 않는다(§B) — window.print() + @page A4.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PerfReport as PerfReportData, PerfTaskRow } from "@/lib/perf-report";
import type { SessionUser } from "@/lib/types";

const GOAL_STATUS: Record<string, { label: string; tone: string }> = {
  ontrack: { label: "온트랙", tone: "--green" },
  risk: { label: "리스크", tone: "--coral" },
  wait: { label: "대기", tone: "--slate" },
  done: { label: "완료", tone: "--blue" },
};

/** 값이 없으면 "-". 0%와 절대 섞지 않는다 (§E). */
const pct = (v: number | null) => (v === null ? "–" : `${v}%`);
/** 증감은 전월 실측값이 있을 때만. 없으면 아무것도 그리지 않는다. */
function Delta({ v }: { v: number | null }) {
  if (v === null) return null;
  if (v === 0) return <span className="prep-delta flat">±0</span>;
  return <span className={`prep-delta ${v > 0 ? "up" : "down"}`}>{v > 0 ? "▲" : "▼"}{Math.abs(v)}</span>;
}

function Empty({ text = "이번 달 해당 항목이 없습니다." }: { text?: string }) {
  return <p className="prep-empty">{text}</p>;
}

/** 영역별 그룹 — 완료 업무 섹션용 */
function groupByArea(rows: PerfTaskRow[]): [string, PerfTaskRow[]][] {
  const map = new Map<string, PerfTaskRow[]>();
  for (const r of rows) {
    const k = r.areaName ?? "영역 미지정";
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return Array.from(map.entries());
}

export default function PerfReport({ user }: { user: SessionUser }) {
  const now = new Date();
  const kstNow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  const [year, setYear] = useState(Number(kstNow.slice(0, 4)));
  const [month, setMonth] = useState(Number(kstNow.slice(5, 7)));
  const [scope, setScope] = useState<"team" | "personal">("team");
  const [actorId, setActorId] = useState<number>(user.id);
  const [data, setData] = useState<PerfReportData | null>(null);
  const [members, setMembers] = useState<{ id: number; name: string }[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const q = new URLSearchParams({ year: String(year), month: String(month), scope });
    if (scope === "personal") q.set("actorId", String(actorId));
    const res = await fetch(`/api/reports/monthly?${q}`).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setLoading(false);
    if (!res || !res.ok) { setErr(d?.error ?? "리포트를 불러올 수 없습니다."); setData(null); return; }
    setData(d.report);
    setMembers(d.members ?? []);
  }, [year, month, scope, actorId]);

  useEffect(() => { load(); }, [load]);

  // 미래 월로는 넘어가지 않는다
  const atLatest = useMemo(
    () => `${year}-${String(month).padStart(2, "0")}` >= kstNow.slice(0, 7),
    [year, month, kstNow]
  );
  function shift(delta: number) {
    let y = year, m = month + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    if (`${y}-${String(m).padStart(2, "0")}` > kstNow.slice(0, 7)) return;
    setYear(y); setMonth(m);
  }

  return (
    <>
      {/* ── 컨트롤 바 (인쇄 제외) ── */}
      <div className="prep-bar no-print">
        <div className="prep-month">
          <button onClick={() => shift(-1)} aria-label="이전 달">‹</button>
          <b className="num">{year}년 {month}월</b>
          <button onClick={() => shift(1)} disabled={atLatest} aria-label="다음 달">›</button>
        </div>

        <div className="seg" role="group" aria-label="리포트 대상">
          <button aria-pressed={scope === "team"} onClick={() => setScope("team")}>팀</button>
          <button aria-pressed={scope === "personal"} onClick={() => setScope("personal")}>개인</button>
        </div>

        {scope === "personal" && user.role === "lead" && members.length > 0 && (
          <select className="prep-who" value={actorId} onChange={(e) => setActorId(Number(e.target.value))}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}

        <span style={{ flex: 1 }} />
        <span className="prep-hint">
          인쇄 대화상자에서 <b>대상 → PDF로 저장</b>을 선택하세요. 배경 그래픽 켜기 권장.
        </span>
        <button className="btn-brand" onClick={() => window.print()} disabled={!data}>PDF로 저장</button>
      </div>

      {err && <p className="gerr no-print">{err}</p>}
      {loading && <p className="gempty no-print">불러오는 중...</p>}

      {/* ── 리포트 본체 = 출력물 ── */}
      {data && (
        <article className="prep" aria-label={`${data.periodLabel} 성과 리포트`}>
          {/* 1. 표지 */}
          <header className="prep-cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="prep-logo" src="/brand/eduino_mark_ondark.png" alt="Eduino AI" width={34} height={24} />
            <div className="prep-cover-b">
              <div className="prep-eb">MONTHLY PERFORMANCE REPORT</div>
              <h1>{data.periodLabel} 성과 리포트</h1>
              <div className="prep-cover-m">
                <span>{data.scope === "team" ? `대상 · ${data.targetLabel}` : `대상 · ${data.targetLabel} (개인)`}</span>
                <span className="num">생성일 {data.generatedAt}</span>
                <span className="num">{data.docNo}</span>
              </div>
            </div>
          </header>

          {/* 2. 요약 */}
          <section className="prep-sec">
            <h2>이번 달 한눈에</h2>
            <div className="prep-kpis">
              <div className="prep-kpi">
                <span className="prep-kpi-v num">{data.summary.completed}</span>
                <span className="prep-kpi-l">완료 업무</span>
              </div>
              <div className="prep-kpi">
                <span className="prep-kpi-v num">{data.summary.inProgress}</span>
                <span className="prep-kpi-l">진행 중</span>
              </div>
              <div className="prep-kpi">
                <span className={`prep-kpi-v num${data.summary.goalAvg === null ? " none" : ""}`}>
                  {pct(data.summary.goalAvg)}
                </span>
                <span className="prep-kpi-l">목표 평균 진척 <Delta v={data.summary.goalAvgDelta} /></span>
              </div>
              <div className="prep-kpi">
                <span className="prep-kpi-v num">{data.summary.decisions}</span>
                <span className="prep-kpi-l">확정 결정</span>
              </div>
            </div>
            {data.summary.goalAvg === null && (
              <p className="prep-note">
                목표 평균 진척이 “–”인 것은 0%가 아니라 <b>집계 대상이 없다</b>는 뜻입니다.
                목표에 프로젝트를 연결하면 집계가 시작됩니다.
              </p>
            )}
            {data.summary.goalAvgDelta === null && data.summary.goalAvg !== null && (
              <p className="prep-note">전월 스냅샷이 없어 증감은 표시하지 않았습니다.</p>
            )}
            {data.missingSnapshot && (
              <p className="prep-note">
                이 달의 진척 스냅샷이 없어 <b>당시 값을 표시할 수 없습니다</b>.
                현재 값을 과거 성과로 적지 않습니다. 스냅샷은 해당 월에 리포트를 한 번이라도 열면 남습니다.
              </p>
            )}
          </section>

          {/* 3. 목표 달성 현황 */}
          <section className="prep-sec">
            <h2>목표 달성 현황</h2>
            {data.goals.length === 0 ? <Empty text="이번 달에 해당하는 목표가 없습니다." /> : (
              <table className="prep-t">
                <thead>
                  <tr>
                    <th style={{ width: "8%" }}>구분</th>
                    <th>목표</th>
                    <th style={{ width: "12%" }}>기간</th>
                    <th style={{ width: "10%" }}>상태</th>
                    <th style={{ width: "22%" }}>진척</th>
                  </tr>
                </thead>
                <tbody>
                  {data.goals.map((g) => {
                    const st = g.status ? GOAL_STATUS[g.status] : null;
                    return (
                      <tr key={g.id}>
                        <td><span className="prep-lv">{g.levelLabel}</span></td>
                        <td>
                          {g.title}
                          {g.manual && <span className="prep-tag">수동</span>}
                          {/* "프로젝트 미연결"은 현재 상태다 — 과거 월 리포트에 오늘 사정을 섞지 않는다 */}
                          {!data.missingSnapshot && g.progress === null && g.projectCount === 0 && (
                            <span className="prep-tag warn">프로젝트 미연결</span>
                          )}
                        </td>
                        <td className="num">{g.period}</td>
                        <td>
                          {st
                            ? <span className="prep-chip" style={{ color: `var(${st.tone})`, background: `color-mix(in srgb, var(${st.tone}) 14%, #fff)` }}>{st.label}</span>
                            : <span className="prep-chip none">{data.missingSnapshot ? "기록 없음" : "집계 없음"}</span>}
                        </td>
                        <td>
                          <div className="prep-prog">
                            <div className={`prep-track${g.progress === null ? " empty" : ""}`}>
                              {g.progress !== null && (
                                <i style={{ width: `${Math.max(g.progress, 2)}%`, background: `var(${st?.tone ?? "--slate"})` }} />
                              )}
                            </div>
                            <span className={`prep-pct num${g.progress === null ? " none" : ""}`}>{pct(g.progress)}</span>
                            <Delta v={g.delta} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* 4. 완료한 업무 */}
          <section className="prep-sec">
            <h2>완료한 업무 <em className="num">{data.completedTasks.length}</em></h2>
            {data.completedTasks.length === 0 ? <Empty text="이번 달 완료한 업무가 없습니다." /> : (
              groupByArea(data.completedTasks).map(([area, rows]) => (
                <div className="prep-group" key={area}>
                  <h3>{area} <em className="num">{rows.length}</em></h3>
                  <table className="prep-t">
                    <thead>
                      <tr>
                        <th style={{ width: "9%" }}>ID</th>
                        <th>제목</th>
                        <th style={{ width: "18%" }}>프로젝트</th>
                        <th style={{ width: "12%" }}>담당</th>
                        <th style={{ width: "13%" }}>완료일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.id}>
                          <td className="num">#{t.id}</td>
                          <td>{t.title}</td>
                          <td>{t.projectName ?? "—"}</td>
                          <td>{t.assigneeName ?? "미지정"}</td>
                          <td className="num">{t.completedAt?.slice(0, 10) ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </section>

          {/* 5. 진행 중 / 이월 */}
          <section className="prep-sec">
            <h2>진행 중 · 이월 <em className="num">{data.ongoingTasks.length}</em></h2>
            {data.ongoingTasks.length === 0 ? <Empty text="진행 중인 업무가 없습니다." /> : (
              <table className="prep-t">
                <thead>
                  <tr>
                    <th style={{ width: "9%" }}>ID</th>
                    <th>제목</th>
                    <th style={{ width: "12%" }}>담당</th>
                    <th style={{ width: "12%" }}>마감</th>
                    <th style={{ width: "14%" }}>진척</th>
                    <th style={{ width: "10%" }}>이월</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ongoingTasks.map((t) => (
                    <tr key={t.id}>
                      <td className="num">#{t.id}</td>
                      <td>{t.title}</td>
                      <td>{t.assigneeName ?? "미지정"}</td>
                      <td className="num">{t.dueDate ?? "—"}</td>
                      <td>
                        <div className="prep-prog sm">
                          <div className="prep-track"><i style={{ width: `${Math.max(t.progress, 2)}%`, background: "var(--blue)" }} /></div>
                          <span className="prep-pct num">{t.progress}%</span>
                        </div>
                      </td>
                      <td>{t.carryOver ? <span className="prep-chip warn">다음 달</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* 6. 확정된 결정 */}
          <section className="prep-sec">
            <h2>확정된 결정 <em className="num">{data.decisions.length}</em></h2>
            {data.decisions.length === 0 ? <Empty text="이번 달 확정된 결정이 없습니다." /> : (
              <table className="prep-t">
                <thead>
                  <tr>
                    <th>결정 내용</th>
                    <th style={{ width: "18%" }}>프로젝트</th>
                    <th style={{ width: "12%" }}>결정자</th>
                    <th style={{ width: "13%" }}>일자</th>
                  </tr>
                </thead>
                <tbody>
                  {data.decisions.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {d.title}
                        {d.rationale && <span className="prep-rat">{d.rationale.replace(/\s+/g, " ").slice(0, 120)}</span>}
                      </td>
                      <td>{d.projectName ?? "—"}</td>
                      <td>{d.decidedByName}</td>
                      <td className="num">{d.decidedAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="prep-note">번복된 결정은 제외하고 확정 상태만 싣습니다.</p>
          </section>

          {/* 7. 다음 달 예정 */}
          <section className="prep-sec">
            <h2>다음 달 예정 <em className="num">{data.nextTasks.length}</em></h2>
            {data.nextTasks.length === 0 ? <Empty text="다음 달 시작 예정 업무가 없습니다." /> : (
              <table className="prep-t">
                <thead>
                  <tr>
                    <th style={{ width: "9%" }}>ID</th>
                    <th>제목</th>
                    <th style={{ width: "18%" }}>프로젝트</th>
                    <th style={{ width: "12%" }}>담당</th>
                    <th style={{ width: "13%" }}>마감</th>
                  </tr>
                </thead>
                <tbody>
                  {data.nextTasks.map((t) => (
                    <tr key={t.id}>
                      <td className="num">#{t.id}</td>
                      <td>{t.title}</td>
                      <td>{t.projectName ?? "—"}</td>
                      <td>{t.assigneeName ?? "미지정"}</td>
                      <td className="num">{t.dueDate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* 푸터 — 인쇄 시 각 페이지 하단에 반복되도록 @page 마진 영역과 함께 쓴다 */}
          <footer className="prep-foot">
            Mission Deck · 내부 검토용 · <span className="num">{data.docNo}</span>
          </footer>
        </article>
      )}
    </>
  );
}

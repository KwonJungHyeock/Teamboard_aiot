"use client";

// 팀 보고의 「페이지」 — 1600×900 한 장 = 한 섹션. 상세 화면 · 발표 · PDF 가 **같은 페이지**를 그린다.
//   ① 목표 달성률(다크) ② 기간 한눈에 ③ 업무 종합표(파트별, 넘치면 여러 장) ④ 업무 상세(업무 1건 = 1장)
//   ⑤ 결정 · 요청 ⑥ (분기 · 연간) 핵심 이슈 ⑦ 다음 기간 계획
// 숫자는 서버(agg)가 낸 값 그대로. 그림은 올린 에셋뿐 — 코드로 그리는 장식은 없다(헤어라인 · 큰 숫자 · 딥그린 하나).
// mode: view(상세 · 편집) · present(발표 — 빈 에셋 자리 숨김, 영상 · iframe 재생) · export(PDF — 영상은 첫 프레임, iframe 은 글)
import type { ReactNode } from "react";

export type Part = "platform" | "rnd" | "etc";
export const PART_LABEL: Record<Part, string> = { platform: "플랫폼", rnd: "R&D", etc: "기타" };
export interface Counts { total: number; done: number; doing: number; hold: number; todo: number }
export interface RTask {
  id: number; title: string; status: string; part: Part; area: string; assigneeId: number | null; assignee: string | null;
  start: string | null; due: string | null; done: string | null; created: string; checks: string | null; description: string; goalIds: number[];
}
export interface LevelRate { level: "year" | "quarter" | "month"; done: number; total: number; rate: number | null; goals: { id: number; title: string; done: number; total: number; rate: number | null }[] }
export interface Agg {
  counts: Counts; parts: Record<Part, Counts>; people: { id: number | null; name: string; counts: Counts }[]; routine: number; goals: LevelRate[];
  trend: { label: string; start: string; counts: Counts; status: string; reportId: number | null }[]; tasks: RTask[]; tidy: RTask[]; autoPlans: RTask[];
}
export interface Asset { id: number; kind: "image" | "gif" | "video" | "iframe"; path: string | null; url: string | null; caption: string }
export interface Item { id: number; taskId: number; summary: string; comment: string; visible: boolean; sortOrder: number; task: RTask | null; assets: Asset[] }
export interface Req { id: number; kind: "decide" | "confirm" | "coop" | "tidy"; body: string; due: string | null; requester: string; status: "open" | "done" | "hold" }
export interface Action { id: number; body: string; assignee_id: number | null; assignee: string | null; due: string | null; status: "todo" | "doing" | "done" }
export interface Issue { id: number; title: string; background: string; alt_a: string; alt_b: string; discussion: string; decision: string; actions: Action[] }
export interface Plan { id: number; body: string; status: string }
export interface PrevPlan { kind: "task" | "manual"; id: number; body: string; status: string; assignee: string | null; due: string | null }
export interface ReportData {
  report: { id: number; kind: "month" | "quarter" | "year"; start: string; end: string; label: string; kindLabel: string; title: string; status: "draft" | "final";
    partOrder: Part[]; headline: string; pdfPath: string | null; finalizedAt: string | null; finalizedBy: string | null; snapshotAt: string | null };
  isLead: boolean; canEdit: boolean; agg: Agg; items: Item[]; requests: Req[]; issues: Issue[]; plans: Plan[]; prevPlans: PrevPlan[];
  people: { id: number; name: string }[]; warnings: string[];
}
export type Mode = "view" | "present" | "export";
export interface PageDef { key: string; label: string; itemId?: number; dark?: boolean; node: ReactNode }

export const fileUrl = (p: string) => `/api/team-reports/file?p=${encodeURIComponent(p)}`;
const STATUS: Record<string, string> = { done: "완료", doing: "진행", review: "검토", hold: "보류", todo: "예정", dropped: "중단" };
export const statusWord = (s: string) => STATUS[s] ?? s;
const REQ_KIND: Record<Req["kind"], string> = { decide: "결정", confirm: "확인", coop: "협조", tidy: "정리" };
const REQ_STATUS: Record<Req["status"], string> = { open: "진행", done: "완료", hold: "보류" };
const md = (d: string | null) => (d ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : "");
const dateOf = (t: RTask) => (t.done ? `완료 ${md(t.done)}` : t.start && t.due && t.start !== t.due ? `${md(t.start)}~${md(t.due)}` : md(t.due ?? t.start) || "—");
const pct = (n: number | null) => (n === null ? "—" : `${n}`);
const LEVEL: Record<LevelRate["level"], string> = { year: "연간", quarter: "분기", month: "월" };
const ROWS_PER_TABLE = 9;

function Page({ dark, children, foot }: { dark?: boolean; children: ReactNode; foot?: ReactNode }) {
  return <div className={`rp-page${dark ? " dark" : ""}`}>{children}{foot && <div className="rp-foot">{foot}</div>}</div>;
}
function Head({ eyebrow, title, right }: { eyebrow: string; title: string; right?: ReactNode }) {
  return <div className="rp-head"><div><p className="rp-eye">{eyebrow}</p><h2>{title}</h2></div>{right && <div className="rp-hr">{right}</div>}</div>;
}
function CountRow({ c }: { c: Counts }) {
  return (
    <div className="rp-big">
      <div><b>{c.total}</b><span>전체</span></div>
      <div><b className="g">{c.done}</b><span>완료</span></div>
      <div><b>{c.doing}</b><span>진행</span></div>
      <div><b>{c.todo}</b><span>예정</span></div>
      {c.hold > 0 && <div><b>{c.hold}</b><span>보류</span></div>}
    </div>
  );
}

function AssetView({ a, mode, posters }: { a: Asset; mode: Mode; posters?: Record<number, string> }) {
  if (a.kind === "iframe") {
    if (mode === "export") return <div className="rp-iframe-txt"><b>{a.caption || "웹 화면"}</b><span>{a.url}</span></div>;
    return <iframe className="rp-media" src={a.url ?? ""} title={a.caption || "에셋"} sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen" />;
  }
  const src = a.path ? fileUrl(a.path) : a.url ?? "";
  if (a.kind === "video") {
    if (mode === "export") return posters?.[a.id] ? <img className="rp-media" src={posters[a.id]} alt={a.caption} /> : <div className="rp-iframe-txt"><b>{a.caption || "영상"}</b></div>;
    return <video className="rp-media" src={src} controls playsInline preload="metadata" />;
  }
  return <img className="rp-media" src={src} alt={a.caption} />;
}

/** 보고 데이터 → 페이지 목록. 파트 순서 · 숨긴 항목 · 빈 에셋 자리(발표 · PDF 에서는 숨김)를 여기서 정한다 */
export function buildPages(d: ReportData, mode: Mode, posters?: Record<number, string>): PageDef[] {
  const r = d.report, a = d.agg, order = r.partOrder;
  const pages: PageDef[] = [];
  const period = `${r.label} ${r.kindLabel} 보고`;

  // ① 목표 달성률 — 큰 숫자 셋 + 목표별 줄(많으면 앞의 다섯)
  const goalRows = a.goals.flatMap((g) => g.goals.map((x) => ({ ...x, level: g.level }))).slice(0, r.headline.trim() ? 4 : 5);
  pages.push({ key: "goals", label: "목표 달성률", dark: true, node: (
    <Page dark foot={<>목표에 연결된 업무의 완료 비율 · 목표에 안 붙은 업무 {a.routine}건은 상시업무(집계 밖)</>}>
      <Head eyebrow={period} title="목표 달성률" />
      <div className="rp-rates">
        {a.goals.map((g) => (
          <div key={g.level}>
            <span>{LEVEL[g.level]} 목표</span>
            <b>{pct(g.rate)}<i>{g.rate === null ? "" : "%"}</i></b>
            <em>{g.total ? `업무 ${g.done}/${g.total} 완료 · 목표 ${g.goals.length}개` : "연결된 업무 없음"}</em>
          </div>
        ))}
      </div>
      {r.headline.trim() ? <p className="rp-headline">{r.headline}</p> : mode === "view" ? <p className="rp-headline ph">핵심 멘트 — 편집에서 적습니다</p> : null}
      {goalRows.length > 0 && (
        <div className="rp-goals">
          {goalRows.map((g) => <div key={g.id}><span>{LEVEL[g.level]}</span><b>{g.title}</b><em>{g.total ? `${g.done}/${g.total}` : "업무 없음"}</em><i>{pct(g.rate)}{g.rate === null ? "" : "%"}</i></div>)}
        </div>
      )}
    </Page>
  ) });

  // ② 기간 한눈에
  const maxPart = Math.max(1, ...order.map((p) => a.parts[p].total));
  pages.push({ key: "overview", label: "한눈에", node: (
    <Page foot={a.tidy.length ? <>기록 정리 필요 {a.tidy.length}건 — 기간 전 업무가 이 기간에 완료로 바뀜(실적 제외)</> : undefined}>
      <Head eyebrow={period} title={`${r.label} 한눈에`} />
      <CountRow c={a.counts} />
      <div className="rp-two">
        <div className="rp-parts">
          {order.map((p) => {
            const c = a.parts[p];
            return (
              <div key={p} className="rp-prow">
                <span className="n">{PART_LABEL[p]}<em>{c.total}</em></span>
                <div className="bar" style={{ width: `${(c.total / maxPart) * 100}%` }}>
                  <i className="d" style={{ flex: c.done }} /><i className="p" style={{ flex: c.doing + c.hold }} /><i className="t" style={{ flex: c.todo }} />
                </div>
                <span className="w">완료 {c.done} · 진행 {c.doing}{c.hold ? ` · 보류 ${c.hold}` : ""} · 예정 {c.todo}</span>
              </div>
            );
          })}
        </div>
        <div className="rp-people">
          <p className="rp-eye">담당</p>
          {a.people.slice(0, 8).map((p) => <div key={String(p.id)}><span>{p.name}</span><b>{p.counts.total}</b><em>완료 {p.counts.done}</em></div>)}
        </div>
      </div>
      {a.trend.length > 0 && (
        <div className="rp-trend">
          {a.trend.map((t) => <div key={t.start}><span>{t.label}</span><b>{t.counts.total}</b><em>완료 {t.counts.done} · {t.status === "final" ? "확정" : t.status === "draft" ? "작성중" : "보고 없음"}</em></div>)}
        </div>
      )}
    </Page>
  ) });

  // ③ 업무 종합표 — 파트별, 넘치면 여러 장
  for (const p of order) {
    const ts = a.tasks.filter((t) => t.part === p);
    if (!ts.length) continue;
    const n = Math.ceil(ts.length / ROWS_PER_TABLE);
    for (let k = 0; k < n; k++) {
      const rows = ts.slice(k * ROWS_PER_TABLE, (k + 1) * ROWS_PER_TABLE);
      pages.push({ key: `table-${p}-${k}`, label: `종합표 · ${PART_LABEL[p]}`, node: (
        <Page>
          <Head eyebrow={`업무 종합표 · ${PART_LABEL[p]}`} title={`${PART_LABEL[p]} 업무 ${ts.length}건${n > 1 ? ` (${k + 1}/${n})` : ""}`}
                right={<span>완료 {a.parts[p].done} · 진행 {a.parts[p].doing} · 예정 {a.parts[p].todo}</span>} />
          <table className="rp-table">
            <thead><tr><th style={{ width: "9%" }}>상태</th><th>업무</th><th style={{ width: "12%" }}>담당</th><th style={{ width: "17%" }}>날짜</th></tr></thead>
            <tbody>{rows.map((t) => (
              <tr key={t.id}><td className={`s-${t.status}`}>{statusWord(t.status)}</td><td>{t.title}</td><td>{t.assignee ?? "—"}</td><td>{dateOf(t)}{t.checks ? ` · ${t.checks}` : ""}</td></tr>
            ))}</tbody>
          </table>
        </Page>
      ) });
    }
  }

  // ④ 파트별 업무 상세 — 업무 1건 = 1장
  for (const p of order) {
    const its = d.items.filter((i) => i.task && i.task.part === p && (i.visible || mode === "view")).sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id);
    for (const it of its) {
      const t = it.task!;
      const showAssets = it.assets.length > 0 || mode === "view";
      pages.push({ key: `item-${it.id}`, label: t.title, itemId: it.id, node: (
        <Page>
          <div className={`rp-item${showAssets ? "" : " solo"}${it.visible ? "" : " hidden"}`}>
            {showAssets && (
              <div className="rp-assets">
                {it.assets.length ? (
                  <>
                    <figure className="main"><AssetView a={it.assets[0]} mode={mode} posters={posters} />{it.assets[0].caption && <figcaption>{it.assets[0].caption}</figcaption>}</figure>
                    {it.assets.length > 1 && (
                      <div className="more">{it.assets.slice(1, 4).map((x) => <figure key={x.id}><AssetView a={x} mode={mode} posters={posters} />{x.caption && <figcaption>{x.caption}</figcaption>}</figure>)}</div>
                    )}
                  </>
                ) : <div className="rp-slot">에셋 자리 — 이미지 · GIF · 영상 · iframe<br />(발표 · PDF 에서는 숨겨집니다)</div>}
              </div>
            )}
            <div className="rp-text">
              <p className="rp-eye">{PART_LABEL[p]} · {statusWord(t.status)}{it.visible ? "" : " · 숨김"}</p>
              <h2>{t.title}</h2>
              <p className="rp-meta">{t.assignee ?? "담당 없음"} · {dateOf(t)}{t.checks ? ` · 체크리스트 ${t.checks}` : ""}</p>
              {it.summary.trim() ? <p className="rp-sum">{it.summary}</p> : mode === "view" ? <p className="rp-sum ph">간단 설명 2~3줄</p> : null}
              {it.comment.trim() ? <p className="rp-quote">{it.comment}</p> : mode === "view" ? <p className="rp-quote ph">핵심 멘트 1~2문장</p> : null}
            </div>
          </div>
        </Page>
      ) });
    }
  }

  // ⑤ 결정 · 요청
  if (d.requests.length || mode === "view") {
    pages.push({ key: "requests", label: "결정 · 요청", node: (
      <Page>
        <Head eyebrow={period} title="결정 · 요청 사항" />
        {d.requests.length ? (
          <table className="rp-table">
            <thead><tr><th style={{ width: "9%" }}>구분</th><th>내용</th><th style={{ width: "11%" }}>기한</th><th style={{ width: "20%" }}>요청</th><th style={{ width: "9%" }}>상태</th></tr></thead>
            <tbody>{d.requests.map((q) => <tr key={q.id}><td className="k">{REQ_KIND[q.kind]}</td><td>{q.body}</td><td>{md(q.due) || "—"}</td><td>{q.requester || "—"}</td><td>{REQ_STATUS[q.status]}</td></tr>)}</tbody>
          </table>
        ) : <p className="rp-empty">결정 · 요청 사항 없음</p>}
      </Page>
    ) });
  }

  // ⑥ 핵심 이슈 — 분기 · 연간만
  if (r.kind !== "month") {
    for (const is of d.issues) {
      pages.push({ key: `issue-${is.id}`, label: `이슈 · ${is.title}`, dark: true, node: (
        <Page dark>
          <Head eyebrow={`핵심 이슈 · ${period}`} title={is.title || "핵심 이슈"} />
          <div className="rp-issue">
            <div><p className="rp-eye">배경 · 현황</p><p>{is.background || "—"}</p></div>
            <div className="ab"><div><p className="rp-eye">대안 A</p><p>{is.alt_a || "—"}</p></div><div><p className="rp-eye">대안 B</p><p>{is.alt_b || "—"}</p></div></div>
            <div><p className="rp-eye">논의 포인트</p><p>{is.discussion || "—"}</p></div>
            <div><p className="rp-eye">결정 결과</p><p className="dec">{is.decision || "—"}</p></div>
            {is.actions.length > 0 && (
              <div><p className="rp-eye">액션 아이템</p>
                {is.actions.map((x) => <p key={x.id} className="act">{x.body}<span>{x.assignee ?? "—"} · {md(x.due) || "—"} · {x.status === "done" ? "완료" : x.status === "doing" ? "진행" : "예정"}</span></p>)}
              </div>
            )}
          </div>
        </Page>
      ) });
    }
  }

  // ⑦ 다음 기간 계획 — 지난 계획의 지금 상태 + 다음 기간에 기한이 걸린 업무 + 손으로 적은 계획
  pages.push({ key: "plan", label: "다음 계획", node: (
    <Page>
      <Head eyebrow={period} title="계획" />
      <div className="rp-two">
        <div className="rp-plan">
          <p className="rp-eye">지난 계획 → 지금</p>
          {d.prevPlans.length ? d.prevPlans.slice(0, 9).map((x) => <div key={`${x.kind}-${x.id}`}><span className={`s-${x.status}`}>{statusWord(x.status)}</span><b>{x.body}</b><em>{x.assignee ?? ""}</em></div>)
            : <p className="rp-empty">지난 보고의 계획 없음</p>}
        </div>
        <div className="rp-plan">
          <p className="rp-eye">다음 기간</p>
          {a.autoPlans.slice(0, 7).map((t) => <div key={`t${t.id}`}><span>{md(t.due)}</span><b>{t.title}</b><em>{t.assignee ?? ""}</em></div>)}
          {d.plans.map((x) => <div key={`p${x.id}`}><span>계획</span><b>{x.body}</b><em /></div>)}
          {!a.autoPlans.length && !d.plans.length && <p className="rp-empty">다음 기간 계획 없음</p>}
        </div>
      </div>
    </Page>
  ) });
  return pages;
}

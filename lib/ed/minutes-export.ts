// 회의록 내보내기 — PDF(브라우저 인쇄 → 「PDF로 저장」) · Word(.doc) · 텍스트(.txt).
// 서버를 거치지 않는다: 화면이 이미 가진 회의 · 회의록 · (고르면) 내 메모로 문서를 만든다.
// Word 는 HTML 문서를 .doc 로 내려받게 한다 — Word · 한글 · Google 문서가 그대로 연다.

export interface MinutesDoc {
  title: string;
  date: string;              // 2026-10-26
  time: string;              // 14:00 – 15:10
  attendees: string[];
  notes: string;             // 함께 쓴 회의록 본문
  agenda: { body: string; done: boolean }[];
  decisions: string[];
  actions: { body: string; who: string; done: boolean }[];
  links: { body: string; url: string | null }[];
  memo?: string;             // 내 메모(고른 경우만)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fileBase = (d: MinutesDoc) => `회의록_${d.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 40)}_${d.date}`;

function section(title: string, inner: string): string {
  return `<h2>${esc(title)}</h2>${inner}`;
}
function list(items: string[], empty = "없음"): string {
  return items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>` : `<p class="f">${empty}</p>`;
}

export function minutesHtml(d: MinutesDoc, forWord = false): string {
  const body = [
    `<h1>${esc(d.title)}</h1>`,
    `<table class="meta"><tr><th>일시</th><td>${esc(d.date)} ${esc(d.time)}</td></tr><tr><th>참석</th><td>${esc(d.attendees.join(", ") || "—")}</td></tr></table>`,
    d.notes.trim() ? section("회의록", `<div class="notes">${esc(d.notes.trim())}</div>`) : "",
    section("안건", list(d.agenda.map((a) => `${a.done ? "✓ " : ""}${esc(a.body)}`))),
    section("결정 사항", list(d.decisions.map(esc))),
    section("할 일", list(d.actions.map((a) => `${a.done ? "✓ " : ""}${esc(a.body)} <span class="w">— ${esc(a.who)}</span>`))),
    d.links.length ? section("링크 · 자료", list(d.links.map((l) => (l.url ? `<a href="${esc(l.url)}">${esc(l.body)}</a>` : esc(l.body))))) : "",
    d.memo && d.memo.trim() ? section("내 메모", `<div class="notes memo">${esc(d.memo.trim())}</div>`) : "",
  ].join("\n");
  const css = `
    @page { size: A4; margin: 18mm 16mm; }
    body { font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", sans-serif; color: #1b2230; font-size: 11pt; line-height: 1.65; ${forWord ? "" : "max-width: 760px; margin: 24px auto; padding: 0 16px;"} }
    h1 { font-size: 20pt; margin: 0 0 10px; }
    h2 { font-size: 12.5pt; margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #d5dbe5; }
    table.meta { border-collapse: collapse; margin: 6px 0 4px; }
    table.meta th { text-align: left; font-weight: 700; color: #5a6476; padding: 2px 14px 2px 0; white-space: nowrap; vertical-align: top; }
    table.meta td { padding: 2px 0; }
    ul { margin: 4px 0; padding-left: 20px; } li { margin: 2px 0; }
    .notes { white-space: pre-wrap; }
    .memo { padding: 10px 12px; background: #f4f6fa; border-radius: 6px; }
    .f, .w { color: #7a8496; }
    a { color: #2f5bea; }`;
  const head = forWord
    ? `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>${css}</style></head>`
    : `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(fileBase(d))}</title><style>${css}</style></head>`;
  return `${head}<body>${body}</body></html>`;
}

export function minutesText(d: MinutesDoc): string {
  const L: string[] = [d.title, `일시: ${d.date} ${d.time}`, `참석: ${d.attendees.join(", ") || "—"}`, ""];
  if (d.notes.trim()) L.push("■ 회의록", d.notes.trim(), "");
  const block = (t: string, xs: string[]) => { L.push(`■ ${t}`, ...(xs.length ? xs.map((x) => `- ${x}`) : ["(없음)"]), ""); };
  block("안건", d.agenda.map((a) => `${a.done ? "[완료] " : ""}${a.body}`));
  block("결정 사항", d.decisions);
  block("할 일", d.actions.map((a) => `${a.done ? "[완료] " : ""}${a.body} — ${a.who}`));
  if (d.links.length) block("링크 · 자료", d.links.map((l) => (l.url && l.url !== l.body ? `${l.body} (${l.url})` : l.body)));
  if (d.memo && d.memo.trim()) L.push("■ 내 메모", d.memo.trim(), "");
  return L.join("\n");
}

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob(["﻿", content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** PDF — 새 창에 문서를 띄우고 인쇄 창을 연다(대상: 「PDF로 저장」). 팝업이 막히면 false */
export function printMinutes(d: MinutesDoc): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(minutesHtml(d).replace("</body>", `<script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body>`));
  w.document.close();
  return true;
}
export const saveWord = (d: MinutesDoc) => download(`${fileBase(d)}.doc`, "application/msword", minutesHtml(d, true));
export const saveText = (d: MinutesDoc) => download(`${fileBase(d)}.txt`, "text/plain;charset=utf-8", minutesText(d));

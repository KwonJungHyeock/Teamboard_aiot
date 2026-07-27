"use client";

// 경량 마크다운 렌더 (파트 3) — 외부 라이브러리 없이 안전한 부분집합만.
// 지원: 제목(#,##,###), 불릿(-,*), 이미지 ![](url) 인라인, 링크 [text](url), 맨 URL → 링크 카드,
//   **굵게**, `코드`, 줄바꿈. dangerouslySetInnerHTML 미사용(React 노드로 조립, XSS 안전).
import React from "react";

const SAFE = /^(https?:\/\/|\/|blob:)/i;
function safe(url: string): boolean {
  return SAFE.test(url.trim());
}
function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// 인라인 토큰화 — 이미지·링크·굵게·코드·맨URL을 순서대로 React 노드로.
function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 이미지 | 링크 | 굵게 | 코드 | 자동링크(맨 URL)
  const re =
    /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1] !== undefined && m[2] !== undefined) {
      // 이미지
      if (safe(m[2])) nodes.push(<img key={k} className="md-img" src={m[2]} alt={m[1] || "이미지"} loading="lazy" />);
      else nodes.push(m[0]);
    } else if (m[3] !== undefined && m[4] !== undefined) {
      // 링크
      if (safe(m[4])) nodes.push(<a key={k} className="md-a" href={m[4]} target="_blank" rel="noreferrer">{m[3]}</a>);
      else nodes.push(m[3]);
    } else if (m[5] !== undefined) {
      nodes.push(<strong key={k}>{m[5]}</strong>);
    } else if (m[6] !== undefined) {
      nodes.push(<code key={k} className="md-code">{m[6]}</code>);
    } else if (m[7] !== undefined) {
      // 맨 URL → 링크 카드
      nodes.push(
        <a key={k} className="md-link-card" href={m[7]} target="_blank" rel="noreferrer" title={m[7]}>
          <span className="md-lc-host">{host(m[7])}</span>
          <span className="md-lc-url">{m[7].replace(/^https?:\/\//, "")}</span>
        </a>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const src = (text ?? "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(<ul key={`ul-${blocks.length}`} className="md-ul">{list}</ul>);
      list = [];
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) { flush(); blocks.push(<h5 key={idx} className="md-h">{inline(line.replace(/^###\s+/, ""), `h${idx}`)}</h5>); return; }
    if (/^##\s+/.test(line)) { flush(); blocks.push(<h4 key={idx} className="md-h">{inline(line.replace(/^##\s+/, ""), `h${idx}`)}</h4>); return; }
    if (/^#\s+/.test(line)) { flush(); blocks.push(<h4 key={idx} className="md-h">{inline(line.replace(/^#\s+/, ""), `h${idx}`)}</h4>); return; }
    if (/^[-*]\s+/.test(line)) { list.push(<li key={idx}>{inline(line.replace(/^[-*]\s+/, ""), `li${idx}`)}</li>); return; }
    if (line.trim() === "") { flush(); return; }
    flush();
    blocks.push(<p key={idx} className="md-p">{inline(line, `p${idx}`)}</p>);
  });
  flush();
  return <div className={`md${className ? ` ${className}` : ""}`}>{blocks}</div>;
}

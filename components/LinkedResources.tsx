"use client";

// 연결된 리소스 — 자동 집계 (MD-P-2026-020 §F3).
// 등록 UI가 없다. 아래 네 곳을 스캔해서 그대로 비춘다:
//   ① 문서 본문의 link/image 블록          ② 문서 본문의 내부 링크 카드(업무·결정·프로젝트)
//   ③ 속성의 프로젝트 연결                  ④ 속성의 목표 연결
//   + MD-P-2026-012에서 이미 등록된 external_link 행(읽기 전용)
// 본문에서 링크를 지우면 여기서도 사라진다 — 본문이 단일 소스다.
// 항목이 0개면 섹션 자체를 그리지 않는다.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { openTaskPanel } from "@/lib/task-panel";
import { openPanel } from "@/lib/side-panel";
import type { DocBlock } from "./DocEditor";

type Provider = "notion" | "figma" | "github" | "internal" | "other";

const PROVIDER: Record<Provider, { label: string; mark: string; cls: string }> = {
  notion: { label: "Notion", mark: "N", cls: "notion" },
  figma: { label: "Figma", mark: "F", cls: "figma" },
  github: { label: "GitHub", mark: "G", cls: "github" },
  internal: { label: "내부", mark: "◆", cls: "internal" },
  other: { label: "링크", mark: "↗", cls: "other" },
};

function providerOf(url: string, hint?: string | null): Provider {
  const h = (hint ?? "").toLowerCase();
  if (h === "notion" || h === "figma" || h === "github") return h;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.endsWith("notion.so") || host.endsWith("notion.site")) return "notion";
    if (host.endsWith("figma.com")) return "figma";
    if (host.endsWith("github.com")) return "github";
    return "other";
  } catch {
    return "other";
  }
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

interface Item {
  key: string;
  provider: Provider;
  title: string;
  sub: string;
  /** 외부 링크면 url, 내부면 null */
  url: string | null;
  open?: () => void;
  /** 어디서 왔는지 — 사용자가 "왜 여기 있지?"를 알 수 있게 */
  from: string;
}

interface StoredLink {
  id: number; url: string; title: string | null; provider: string; domain: string | null;
}

export default function LinkedResources({
  taskId, blocks, projectId, projectName, goals,
}: {
  taskId: number;
  blocks: DocBlock[];
  projectId: number | null;
  projectName: string | null;
  goals: { id: number; title: string }[];
}) {
  const router = useRouter();
  const [stored, setStored] = useState<StoredLink[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/links?entityType=task&entityId=${taskId}`)
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .then((d) => alive && setStored(d.links ?? []))
      .catch(() => {});
    return () => { alive = false; };
  }, [taskId]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const seen = new Set<string>();
    const push = (it: Item, dedupeOn?: string) => {
      const k = dedupeOn ?? it.key;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(it);
    };

    // ① · ② 문서 본문
    for (const b of blocks) {
      if (b.internal) {
        const c = b.internal;
        push({
          key: `int-${c.kind}-${c.id}`, provider: "internal",
          title: c.title, sub: `${c.kind === "task" ? "업무" : c.kind === "decision" ? "결정" : "프로젝트"} #${c.id}`,
          url: null, from: "본문",
          open: () => {
            if (c.kind === "task") openTaskPanel(c.id);
            else if (c.kind === "decision") openPanel("decision", c.id);
            else router.push(`/projects/${c.id}`);
          },
        });
        continue;
      }
      if ((b.type === "link" || b.type === "image") && b.url) {
        const p = providerOf(b.url, b.meta?.provider);
        push({
          key: `doc-${b.id}`, provider: p,
          title: b.meta?.title || (b.type === "image" ? "이미지" : domainOf(b.url)),
          sub: b.meta?.domain || domainOf(b.url), url: b.url, from: "본문",
        }, `url:${b.url}`);
      }
    }

    // MD-P-2026-012에서 이미 등록된 링크 (읽기 전용으로 함께 비춘다)
    for (const l of stored) {
      push({
        key: `st-${l.id}`, provider: providerOf(l.url, l.provider),
        title: l.title || domainOf(l.url), sub: l.domain || domainOf(l.url),
        url: l.url, from: "등록됨",
      }, `url:${l.url}`);
    }

    // ③ 속성 — 프로젝트
    if (projectId) {
      push({
        key: `prj-${projectId}`, provider: "internal",
        title: projectName ?? `프로젝트 #${projectId}`, sub: "프로젝트",
        url: null, from: "속성", open: () => router.push(`/projects/${projectId}`),
      });
    }
    // ④ 속성 — 목표
    for (const g of goals) {
      push({
        key: `goal-${g.id}`, provider: "internal",
        title: g.title, sub: "목표", url: null, from: "속성",
        open: () => router.push(`/goals?goal=${g.id}`),
      });
    }

    return out;
  }, [blocks, stored, projectId, projectName, goals, router]);

  if (items.length === 0) return null; // 빈 섹션 금지

  return (
    <div className="tdp-sec lr">
      <div className="tdp-sec-h">연결된 리소스 <em>({items.length})</em></div>
      <div className="lr-list">
        {items.map((it) => {
          const p = PROVIDER[it.provider];
          const inner = (
            <>
              <span className={`lr-mark ${p.cls}`} aria-hidden="true">{p.mark}</span>
              <span className="lr-b">
                <span className="lr-t">{it.title}</span>
                <span className="lr-m">{p.label} · {it.sub}</span>
              </span>
              <span className="lr-from">{it.from}</span>
            </>
          );
          return it.url ? (
            <a className="lr-row" key={it.key} href={it.url} target="_blank" rel="noreferrer noopener">{inner}</a>
          ) : (
            <button className="lr-row" key={it.key} onClick={it.open}>{inner}</button>
          );
        })}
      </div>
      <p className="lr-note">본문 링크·속성 연결에서 자동으로 모읍니다. 본문에서 지우면 여기서도 사라집니다.</p>
    </div>
  );
}

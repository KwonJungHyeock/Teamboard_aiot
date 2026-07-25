"use client";

// 영역 작업 공간 (파트 6) — /areas/[key]. 영역 이름=스페이스 제목, 영역 색 헤더 액센트.
// 탭: 업무/프로젝트/목표/자료. 업무 탭은 TaskTable 재사용, "+ 이 영역에 업무 추가"는
// 영역·기본 업무유형을 고정한 새 업무 패널을 연다.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import TaskTable, { type TaskTableRow } from "./TaskTable";
import { openNewTaskPanel, openTaskPanel, TASK_UPDATED_EVENT } from "@/lib/task-panel";

interface AreaOverview {
  area: { id: number; name: string; colorKey: string | null; defaultWorkType: string };
  tasks: (TaskTableRow & { workType: string })[];
  projects: { id: number; name: string; colorKey: string | null; status: string; total: number; done: number; percent: number | null }[];
  goals: { id: number; title: string; period: string; progress: number | null; colorKey: string | null }[];
  assets: { id: number; kind: string; title: string; url: string; projectName: string | null }[];
}

type Tab = "tasks" | "projects" | "goals" | "assets";
const TABS: { key: Tab; label: string }[] = [
  { key: "tasks", label: "업무" },
  { key: "projects", label: "프로젝트" },
  { key: "goals", label: "목표" },
  { key: "assets", label: "자료" },
];

const PST: Record<string, { label: string; cls: string }> = {
  active: { label: "진행", cls: "active" },
  hold: { label: "보류", cls: "hold" },
  done: { label: "완료", cls: "" },
};

export default function AreaView({ areaKey }: { areaKey: string }) {
  const [data, setData] = useState<AreaOverview | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("tasks");

  const load = useCallback(async () => {
    const res = await fetch(`/api/areas/${areaKey}/overview`);
    if (!res.ok) { setErr("영역을 불러올 수 없습니다."); return; }
    setData(await res.json());
    setErr("");
  }, [areaKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onUpd = () => load();
    window.addEventListener(TASK_UPDATED_EVENT, onUpd);
    return () => window.removeEventListener(TASK_UPDATED_EVENT, onUpd);
  }, [load]);

  const area = data?.area;
  const accent = area?.colorKey ?? "team";

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>{area ? area.name : "영역"}</b>
        </div>
        <span className="sp" />
        {area && (
          <button
            className="newbtn"
            onClick={() => openNewTaskPanel({ areaId: area.id, workType: area.defaultWorkType })}
          >
            ＋ 이 영역에 업무 추가
          </button>
        )}
      </div>

      <div className="wrap">
        {err && <p className="gerr">{err}</p>}
        {!data && !err && <p className="gempty">불러오는 중…</p>}

        {area && data && (
          <>
            <div className={`area-hd ${accent}`}>
              <span className="area-dot" />
              <div>
                <div className="eb">업무 영역</div>
                <h1>{area.name}</h1>
                <p>
                  업무 {data.tasks.length} · 프로젝트 {data.projects.length} · 목표 {data.goals.length} · 자료 {data.assets.length}
                </p>
              </div>
            </div>

            <div className="tabs" role="tablist">
              {TABS.map((tItem) => (
                <button
                  key={tItem.key}
                  className="tab"
                  role="tab"
                  aria-pressed={tab === tItem.key}
                  onClick={() => setTab(tItem.key)}
                >
                  {tItem.label}
                  <span className="n">
                    {tItem.key === "tasks" ? data.tasks.length
                      : tItem.key === "projects" ? data.projects.length
                      : tItem.key === "goals" ? data.goals.length
                      : data.assets.length}
                  </span>
                </button>
              ))}
            </div>

            {tab === "tasks" && (
              <TaskTable
                rows={data.tasks}
                variant="full"
                title="업무"
                sub={`${data.tasks.length}건 · 기본 유형 ${labelWorkType(area.defaultWorkType)}`}
                emptyText="이 영역에 아직 업무가 없어요"
                emptyHint={`"+ 이 영역에 업무 추가"로 ${area.name} 업무를 시작하세요. 영역·기본 업무유형이 미리 채워집니다.`}
                emptyAction={
                  <button
                    className="btn small primary"
                    onClick={() => openNewTaskPanel({ areaId: area.id, workType: area.defaultWorkType })}
                  >
                    ＋ 이 영역에 업무 추가
                  </button>
                }
                onRowClick={(id) => openTaskPanel(id)}
              />
            )}

            {tab === "projects" && (
              <section className="card">
                <div className="ch"><h2>프로젝트</h2><span className="sub">{data.projects.length}개</span></div>
                {data.projects.length === 0 && <p className="gempty">이 영역에 프로젝트가 없습니다.</p>}
                <div className="pgrid">
                  {data.projects.map((p) => (
                    <Link key={p.id} className="pcard card" href={`/projects/${p.id}`}>
                      <div className="pcard-h">
                        <span className="pj">
                          <i className={p.colorKey ?? "team"} />
                          <b>{p.name}</b>
                        </span>
                        <span className="gsp" />
                        <span className={`pst ${p.status}`}>{PST[p.status]?.label ?? p.status}</span>
                      </div>
                      <div className="pcard-bar">
                        <div className="bar">
                          <i className={p.colorKey ?? "edu"} style={{ width: `${Math.min(p.percent ?? 0, 100)}%` }} />
                        </div>
                        <span className="gpv">{p.percent === null ? "-" : `${p.percent}%`}</span>
                      </div>
                      <div className="pcard-m"><span>완료 {p.done}/{p.total}</span></div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {tab === "goals" && (
              <section className="card">
                <div className="ch"><h2>목표</h2><span className="sub">{data.goals.length}개</span></div>
                {data.goals.length === 0 && <p className="gempty">이 영역에 목표가 없습니다.</p>}
                {data.goals.map((g) => (
                  <div className="pr" key={g.id}>
                    <div className="pr-t">
                      <span>{g.title} <em className="gdrop">{g.period}</em></span>
                      <span>{g.progress === null ? "-" : `${g.progress}%`}</span>
                    </div>
                    <div className="bar">
                      <i className={g.colorKey ?? "edu"} style={{ width: `${Math.min(g.progress ?? 0, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </section>
            )}

            {tab === "assets" && (
              <section className="card">
                <div className="ch"><h2>자료</h2><span className="sub">{data.assets.length}건</span></div>
                {data.assets.length === 0 && <p className="gempty">연결된 자료가 없습니다.</p>}
                <div className="acards">
                  {data.assets.map((a) => (
                    <div className="acard" key={a.id}>
                      <span className={`akind ${a.kind}`}>{a.kind}</span>
                      <a className="acard-t" href={a.url} target="_blank" rel="noreferrer">{a.title}</a>
                      {a.projectName && <em className="acard-u">{a.projectName}</em>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function labelWorkType(v: string): string {
  return v === "personal" ? "개인업무" : v === "routine" ? "상시업무" : "팀업무";
}

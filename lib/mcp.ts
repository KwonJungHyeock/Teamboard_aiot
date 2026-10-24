// Claude 연결 창구(MCP)의 도구들 (2026-10 Claude 연동 · 0040).
//
// ── 규칙을 새로 만들지 않는다 ────────────────────────────────────────
//
// 도구는 전부 **앱의 기존 API 를 그 사람으로서** 부른다(`call`). 화면에서 누르는 것과
// 같은 길이라, 남의 개인 업무가 안 보이는 것 · 고칠 수 없는 칸 · 날짜 검사 같은 규칙이
// 여기서도 그대로 걸린다. 여기는 말을 API 로 옮기고, 답을 사람 말로 옮길 뿐이다.
//
// ── 일부러 안 연 것 ──────────────────────────────────────────────────
//   · 지우기(업무 · 기록) — Claude 가 잘못 알아들으면 되돌리기 어렵다. 화면에서 한다
//   · 남의 업무 담당 바꾸기 · 공개 범위 바꾸기 — 팀 규칙에 닿는 일은 사람이 화면에서
export type Call = (path: string, init?: { method?: string; body?: unknown }) =>
  Promise<{ status: number; data: any }>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD (서울 날짜)" };
const STATUS_LABEL: Record<string, string> = { todo: "대기", doing: "진행", review: "리뷰", done: "완료", dropped: "중단", proposed: "제안" };

export const INSTRUCTIONS = [
  "AI 로봇 플랫폼팀 통합업무관리(팀보드)에 연결되어 있다. 이 연결은 한 사람의 것이고, 모든 쓰기는 그 사람 이름으로 남는다.",
  "· 사용자가 **이미 한 일**을 말하면 add_worklog(내 기록). **앞으로 할 일**이면 create_task(내 업무). 어느 쪽인지 애매하면 먼저 묻는다.",
  "· 기존 것을 고쳐 달라고 하면 list_worklog / list_my_tasks 로 먼저 찾아 번호를 확인하고, 무엇을 어떻게 바꿀지 한 줄로 말한 뒤 update_* 를 부른다.",
  "· 「끝났어」는 update_task 의 status=done 이다.",
  "· 지우기는 이 연결로 할 수 없다. 지워 달라고 하면 앱 화면에서 지우라고 안내한다.",
].join("\n");

export const TOOLS: ToolDef[] = [
  {
    name: "add_worklog",
    description: "「내 기록」에 내가 한 일 한 줄을 남긴다(나만 보는 업무기록). 본문에 #카테고리 를 넣으면 그 카테고리로 간다(없으면 생긴다). 날짜를 안 주면 오늘.",
    inputSchema: { type: "object", properties: { body: { type: "string", description: "한 일. 예: \"#학생페이지 로그인 화면 마무리\"" }, date: DATE }, required: ["body"] },
  },
  {
    name: "list_worklog",
    description: "「내 기록」을 달 단위로 읽는다. 지난 업무를 보고하거나 고칠 기록의 번호를 찾을 때 쓴다.",
    inputSchema: { type: "object", properties: {
      month: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "YYYY-MM. 안 주면 이번 달" },
      query: { type: "string", description: "이 낱말이 든 기록만" } } },
  },
  {
    name: "update_worklog",
    description: "「내 기록」 한 줄을 고친다(본문 · 날짜). 번호는 list_worklog 로 찾는다.",
    inputSchema: { type: "object", properties: { id: { type: "integer" }, body: { type: "string" }, date: DATE }, required: ["id"] },
  },
  {
    name: "list_my_tasks",
    description: "내가 담당인 업무를 읽는다. 기본은 아직 안 끝난 것. 지난 업무 보고에는 status=done.",
    inputSchema: { type: "object", properties: {
      status: { type: "string", enum: ["open", "done", "all"], description: "open(기본) · done · all" },
      query: { type: "string", description: "제목에 이 낱말이 든 것만" } } },
  },
  {
    name: "get_task",
    description: "업무 하나를 자세히 읽는다(설명 · 기한 · 진행률 · 최근 활동).",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
  },
  {
    name: "create_task",
    description: "「내 업무」에 새 업무를 만든다(담당은 나, 팀 공개). 앞으로 할 일일 때만.",
    inputSchema: { type: "object", properties: {
      title: { type: "string" }, description: { type: "string" }, due_date: DATE, start_date: DATE }, required: ["title"] },
  },
  {
    name: "update_task",
    description: "업무를 고친다 — 제목 · 설명 · 상태 · 기한 · 시작일 · 진행률. 끝났으면 status=done. 번호는 list_my_tasks 로 찾는다.",
    inputSchema: { type: "object", properties: {
      id: { type: "integer" }, title: { type: "string" }, description: { type: "string" },
      status: { type: "string", enum: ["todo", "doing", "review", "done"], description: "대기 · 진행 · 리뷰 · 완료" },
      due_date: DATE, start_date: DATE,
      progress: { type: "integer", minimum: 0, maximum: 100 } }, required: ["id"] },
  },
  {
    name: "set_today",
    description: "관제 「지금 팀」에 뜨는 「오늘 할 일」 한 줄과 상태를 정한다(팀이 본다). 상태: focus(집중) · out(외근) · off(휴가) · 빈 값(보통).",
    inputSchema: { type: "object", properties: {
      line: { type: "string", description: "오늘 할 일 한 줄. 빈 글자면 지운다" },
      state: { type: "string", enum: ["focus", "out", "off", ""] } } },
  },
  {
    name: "get_weekly_brief",
    description: "팀의 AI 주간 브리핑을 읽는다(관제에 뜨는 것과 같다). week: last(지난주 · 기본) · this(이번 주). 아직 없으면 없다고 답한다 — 만들지는 않는다.",
    inputSchema: { type: "object", properties: { week: { type: "string", enum: ["last", "this"] } } },
  },
];

const err = (r: { status: number; data: any }, fallback: string) =>
  `실패 (${r.status}) — ${r.data?.error ?? fallback}`;
const taskLine = (t: any) =>
  `#${t.id} [${STATUS_LABEL[t.status] ?? t.status}] ${t.title}` +
  `${t.dueDate ? ` · 기한 ${t.dueDate}` : ""}${typeof t.progress === "number" && t.progress ? ` · ${t.progress}%` : ""}`;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const int = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** 도구 하나를 부른다. 돌려주는 글은 Claude 가 읽고 사람에게 옮긴다. */
export async function runTool(name: string, args: Record<string, unknown>, me: { id: number }, call: Call):
  Promise<{ text: string; isError?: boolean }> {
  switch (name) {
    case "add_worklog": {
      const r = await call("/api/worklog", { method: "POST", body: { body: args.body, loggedOn: str(args.date) } });
      if (r.status !== 200) return { text: err(r, "기록하지 못했습니다."), isError: true };
      const e = r.data.entry;
      return { text: `내 기록에 남겼습니다 — #${e.id} ${e.loggedOn} ${e.body}` };
    }
    case "list_worklog": {
      const month = str(args.month) ?? "";
      const r = await call(`/api/worklog${month ? `?month=${encodeURIComponent(month)}` : ""}`);
      if (r.status !== 200) return { text: err(r, "읽지 못했습니다."), isError: true };
      const cats = new Map<number, string>((r.data.categories ?? []).map((c: any) => [c.id, c.name]));
      const q = (str(args.query) ?? "").trim();
      const rows = (r.data.entries ?? []).filter((e: any) => !q || e.body.includes(q));
      if (!rows.length) return { text: `${r.data.month} 내 기록 — ${q ? `「${q}」 든 것 ` : ""}없음` };
      return { text: [`${r.data.month} 내 기록 ${rows.length}줄`, ...rows.map((e: any) =>
        `#${e.id} ${e.loggedOn}${e.categoryId && cats.get(e.categoryId) ? ` [${cats.get(e.categoryId)}]` : ""} ${e.body}` +
        `${e.attachments?.length ? ` (첨부 ${e.attachments.length})` : ""}`)].join("\n") };
    }
    case "update_worklog": {
      const id = int(args.id);
      if (!id) return { text: "번호(id)가 필요합니다.", isError: true };
      const body: Record<string, unknown> = {};
      if (args.body !== undefined) body.body = args.body;
      if (args.date !== undefined) body.loggedOn = args.date;
      const r = await call(`/api/worklog/${id}`, { method: "PATCH", body });
      if (r.status !== 200) return { text: err(r, "고치지 못했습니다."), isError: true };
      const e = r.data.entry;
      return { text: `고쳤습니다 — #${e?.id ?? id} ${e?.loggedOn ?? ""} ${e?.body ?? ""}`.trim() };
    }
    case "list_my_tasks": {
      const status = str(args.status) ?? "open";
      const r = await call(`/api/tasks?assignee=${me.id}${status === "done" ? "&status=done" : ""}`);
      if (r.status !== 200) return { text: err(r, "읽지 못했습니다."), isError: true };
      const q = (str(args.query) ?? "").trim();
      let rows = (r.data.tasks ?? []).filter((t: any) => t.assigneeId === me.id);
      if (status === "open") rows = rows.filter((t: any) => ["todo", "doing", "review"].includes(t.status));
      if (q) rows = rows.filter((t: any) => String(t.title).includes(q));
      if (!rows.length) return { text: "해당하는 내 업무가 없습니다." };
      return { text: [`내 업무 ${rows.length}건 (${status})`, ...rows.slice(0, 60).map(taskLine)].join("\n") };
    }
    case "get_task": {
      const id = int(args.id);
      if (!id) return { text: "번호(id)가 필요합니다.", isError: true };
      const r = await call(`/api/tasks/${id}`);
      if (r.status !== 200) return { text: err(r, "업무를 찾을 수 없습니다."), isError: true };
      const t = r.data.task;
      const acts = (r.data.activity ?? []).slice(0, 5).map((a: any) => `  · ${String(a.createdAt ?? a.created_at ?? "").slice(0, 16)} ${a.message}`);
      return { text: [taskLine(t), `담당 ${t.assigneeName ?? "없음"} · 영역 ${t.areaName ?? ""}${t.startDate ? ` · 시작 ${t.startDate}` : ""}`,
        t.description ? `설명: ${t.description}` : "설명 없음", ...(acts.length ? ["최근 활동:", ...acts] : [])].join("\n") };
    }
    case "create_task": {
      const r = await call("/api/tasks", { method: "POST", body: {
        title: args.title, description: str(args.description), dueDate: str(args.due_date), startDate: str(args.start_date), assigneeId: me.id } });
      if (r.status !== 200) return { text: err(r, "업무를 만들지 못했습니다."), isError: true };
      return { text: `내 업무에 만들었습니다 — #${r.data.id} ${args.title}` };
    }
    case "update_task": {
      const id = int(args.id);
      if (!id) return { text: "번호(id)가 필요합니다.", isError: true };
      const body: Record<string, unknown> = {};
      if (args.title !== undefined) body.title = args.title;
      if (args.description !== undefined) body.description = args.description;
      if (args.status !== undefined) body.status = args.status;
      if (args.due_date !== undefined) body.dueDate = args.due_date || null;
      if (args.start_date !== undefined) body.startDate = args.start_date || null;
      if (args.progress !== undefined) body.progress = args.progress;
      if (!Object.keys(body).length) return { text: "바꿀 것이 없습니다.", isError: true };
      const r = await call(`/api/tasks/${id}`, { method: "PATCH", body });
      if (r.status !== 200) return { text: err(r, "고치지 못했습니다."), isError: true };
      const after = await call(`/api/tasks/${id}`);
      return { text: `고쳤습니다 — ${after.status === 200 ? taskLine(after.data.task) : `#${id}`}` };
    }
    case "set_today": {
      const body: Record<string, unknown> = {};
      if (args.line !== undefined) body.line = args.line;
      if (args.state !== undefined) body.state = args.state || null;
      const r = await call("/api/daily", { method: "PUT", body });
      if (r.status !== 200) return { text: err(r, "저장하지 못했습니다."), isError: true };
      const n = r.data.note;
      return { text: `오늘 줄을 정했습니다 — ${n.line ?? "(한 줄 없음)"} · 상태 ${({ focus: "집중", out: "외근", off: "휴가" } as any)[n.state] ?? "보통"}` };
    }
    case "get_weekly_brief": {
      const week = args.week === "this" ? "this" : "last";
      const r = await call(`/api/brief?week=${week}`);
      if (r.status !== 200) return { text: err(r, "읽지 못했습니다."), isError: true };
      const b = r.data.brief;
      if (!b) return { text: `${week === "this" ? "이번 주" : "지난주"}(${r.data.week.start} ~ ${r.data.week.end}) 브리핑이 아직 없습니다. 관제 화면에서 「브리핑 만들기」를 누르면 생깁니다.` };
      return { text: `주간 브리핑 ${b.weekStart} ~ ${b.weekEnd}${b.demo ? " (데모)" : ""}\n${b.text}` };
    }
    default:
      return { text: `모르는 도구입니다: ${name}`, isError: true };
  }
}

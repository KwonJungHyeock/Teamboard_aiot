// 팀 보고의 줄들 — 항목 · 에셋 · 결정/요청 · 이슈 · 액션 · 계획. 만들기 · 고치기 · 지우기(소프트) · 순서.
//
// 줄마다 고칠 수 있는 칸을 표로 적어 두고, 그 표 밖의 칸은 받지 않는다(이름을 SQL 에 그대로 쓰므로).
// 확정한 보고의 줄은 못 고친다 — 단, 계획 줄의 「상태」만은 다음 보고가 「지난 계획」으로 갱신한다.
import { query, queryOne } from "./db";
import { reportIdOfPath } from "./report-files";
import { isDay, ReportError } from "./team-report";

type Field = { col: string; kind: "text" | "bool" | "date" | "int" | "enum"; max?: number; values?: string[] };
interface Res {
  table: string;
  /** 이 줄이 속한 보고 번호를 내는 SQL($1 = 줄 번호) */
  reportOf: string;
  fields: Record<string, Field>;
}
const T = (col: string, max: number): Field => ({ col, kind: "text", max });
export const RES: Record<string, Res> = {
  items: { table: "team_report_item", reportOf: `SELECT report_id FROM team_report_item WHERE id = $1`,
    fields: { summary: T("summary", 600), comment: T("comment", 300), visible: { col: "visible", kind: "bool" } } },
  assets: { table: "team_report_asset", reportOf: `SELECT i.report_id FROM team_report_asset a JOIN team_report_item i ON i.id = a.item_id WHERE a.id = $1`,
    fields: { caption: T("caption", 200) } },
  requests: { table: "team_report_request", reportOf: `SELECT report_id FROM team_report_request WHERE id = $1`,
    fields: { kind: { col: "kind", kind: "enum", values: ["decide", "confirm", "coop", "tidy"] }, body: T("body", 600), due: { col: "due_date", kind: "date" },
      requester: T("requester", 80), status: { col: "status", kind: "enum", values: ["open", "done", "hold"] } } },
  issues: { table: "team_report_issue", reportOf: `SELECT report_id FROM team_report_issue WHERE id = $1`,
    fields: { title: T("title", 120), background: T("background", 1200), alt_a: T("alt_a", 800), alt_b: T("alt_b", 800),
      discussion: T("discussion", 1000), decision: T("decision", 1000) } },
  actions: { table: "team_report_action", reportOf: `SELECT s.report_id FROM team_report_action x JOIN team_report_issue s ON s.id = x.issue_id WHERE x.id = $1`,
    fields: { body: T("body", 300), assigneeId: { col: "assignee_id", kind: "int" }, due: { col: "due_date", kind: "date" },
      status: { col: "status", kind: "enum", values: ["todo", "doing", "done"] } } },
  plans: { table: "team_report_plan", reportOf: `SELECT report_id FROM team_report_plan WHERE id = $1`,
    fields: { body: T("body", 300), status: { col: "status", kind: "enum", values: ["todo", "doing", "done", "dropped"] } } },
};

function value(f: Field, v: unknown): unknown {
  if (f.kind === "text") return String(v ?? "").slice(0, f.max ?? 500);
  if (f.kind === "bool") return v === true;
  if (f.kind === "date") { if (v === null || v === "") return null; if (!isDay(v)) throw new ReportError("날짜가 올바르지 않습니다."); return v; }
  if (f.kind === "int") { if (v === null || v === "") return null; const n = Number(v); if (!Number.isInteger(n)) throw new ReportError("값이 올바르지 않습니다."); return n; }
  if (!f.values!.includes(String(v))) throw new ReportError("값이 올바르지 않습니다.");
  return String(v);
}

/** 보고가 살아 있고 작성중인가 — 확정이면 409 */
export async function draftReport(reportId: number, allowFinal = false): Promise<{ id: number; status: string }> {
  const r = await queryOne<{ id: number; status: string }>(`SELECT id, status FROM team_report WHERE id = $1 AND is_active`, [reportId]);
  if (!r) throw new ReportError("보고를 찾을 수 없습니다.", 404);
  if (r.status === "final" && !allowFinal) throw new ReportError("확정한 보고입니다. 고치려면 먼저 「확정 해제」를 누르세요.", 409);
  return r;
}

async function nextOrder(table: string, parentCol: string, parentId: number): Promise<number> {
  return (await queryOne<{ n: number }>(`SELECT COALESCE(max(sort_order), 0) + 1 AS n FROM ${table} WHERE ${parentCol} = $1 AND is_active`, [parentId]))!.n;
}

/** 줄 만들기 — res 마다 받는 값이 다르다 */
export async function createRow(reportId: number, res: string, p: Record<string, unknown>): Promise<number> {
  await draftReport(reportId);
  if (res === "items") {
    const taskId = Number(p.taskId);
    // 팀보드에 등록된 팀 공개 업무만 — 등록 안 된 일은 먼저 업무로 만든다
    const t = await queryOne<{ id: number }>(`SELECT id FROM task WHERE id = $1 AND is_active AND visibility = 'team' AND parent_task_id IS NULL`, [taskId]);
    if (!t) throw new ReportError("팀보드의 팀 공개 업무만 넣을 수 있습니다.");
    const was = await queryOne<{ id: number }>(`SELECT id FROM team_report_item WHERE report_id = $1 AND task_id = $2 AND is_active`, [reportId, taskId]);
    if (was) return was.id;
    return (await queryOne<{ id: number }>(`INSERT INTO team_report_item (report_id, task_id, sort_order) VALUES ($1, $2, $3) RETURNING id`,
      [reportId, taskId, await nextOrder("team_report_item", "report_id", reportId)]))!.id;
  }
  if (res === "assets") {
    const itemId = Number(p.itemId);
    const it = await queryOne<{ id: number }>(`SELECT id FROM team_report_item WHERE id = $1 AND report_id = $2 AND is_active`, [itemId, reportId]);
    if (!it) throw new ReportError("보고 항목을 찾을 수 없습니다.", 404);
    const kind = String(p.kind);
    if (!["image", "gif", "video", "iframe"].includes(kind)) throw new ReportError("에셋 종류가 올바르지 않습니다.");
    let path: string | null = null, url: string | null = null;
    if (kind === "iframe") {
      url = String(p.url ?? "").trim();
      if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 1000) throw new ReportError("iframe 주소는 https:// 로 시작해야 합니다.");
    } else {
      path = String(p.path ?? "");
      if (reportIdOfPath(path) !== reportId) throw new ReportError("올린 파일이 이 보고의 것이 아닙니다.");
    }
    return (await queryOne<{ id: number }>(
      `INSERT INTO team_report_asset (item_id, kind, path, url, caption, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [itemId, kind, path, url, String(p.caption ?? "").slice(0, 200), await nextOrder("team_report_asset", "item_id", itemId)]))!.id;
  }
  if (res === "actions") {
    const issueId = Number(p.issueId);
    const is = await queryOne<{ id: number }>(`SELECT id FROM team_report_issue WHERE id = $1 AND report_id = $2 AND is_active`, [issueId, reportId]);
    if (!is) throw new ReportError("이슈를 찾을 수 없습니다.", 404);
    const f = RES.actions.fields;
    return (await queryOne<{ id: number }>(
      `INSERT INTO team_report_action (issue_id, body, assignee_id, due_date, status, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [issueId, value(f.body, p.body), value(f.assigneeId, p.assigneeId ?? null), value(f.due, p.due ?? null), value(f.status, p.status ?? "todo"),
        await nextOrder("team_report_action", "issue_id", issueId)]))!.id;
  }
  const def = RES[res];
  if (!def || res === "items" || res === "assets") throw new ReportError("모르는 항목입니다.", 404);
  if (res === "issues") {
    const k = await queryOne<{ kind: string }>(`SELECT kind FROM team_report WHERE id = $1`, [reportId]);
    if (k?.kind === "month") throw new ReportError("핵심 이슈는 분기 · 연간 보고에만 있습니다.");
  }
  const cols = ["report_id", "sort_order"]; const vals: unknown[] = [reportId, await nextOrder(def.table, "report_id", reportId)];
  for (const [k, f] of Object.entries(def.fields)) if (p[k] !== undefined) { cols.push(f.col); vals.push(value(f, p[k])); }
  return (await queryOne<{ id: number }>(
    `INSERT INTO ${def.table} (${cols.join(", ")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, vals))!.id;
}

export async function updateRow(res: string, rowId: number, p: Record<string, unknown>): Promise<void> {
  const def = RES[res];
  if (!def) throw new ReportError("모르는 항목입니다.", 404);
  const rid = await queryOne<{ report_id: number }>(def.reportOf, [rowId]);
  if (!rid) throw new ReportError("찾을 수 없습니다.", 404);
  const keys = Object.keys(p).filter((k) => def.fields[k]);
  // 지난 계획의 상태 갱신은 확정한 보고에도 된다
  await draftReport(rid.report_id, res === "plans" && keys.length === 1 && keys[0] === "status");
  if (!keys.length) return;
  const vals: unknown[] = [rowId];
  const sets = keys.map((k) => { vals.push(value(def.fields[k], p[k])); return `${def.fields[k].col} = $${vals.length}`; });
  await query(`UPDATE ${def.table} SET ${sets.join(", ")}${res === "items" ? ", updated_at = now()" : ""} WHERE id = $1 AND is_active`, vals);
}

export async function removeRow(res: string, rowId: number): Promise<void> {
  const def = RES[res];
  if (!def) throw new ReportError("모르는 항목입니다.", 404);
  const rid = await queryOne<{ report_id: number }>(def.reportOf, [rowId]);
  if (!rid) throw new ReportError("찾을 수 없습니다.", 404);
  await draftReport(rid.report_id);
  await query(`UPDATE ${def.table} SET is_active = false WHERE id = $1`, [rowId]);
}

/** 순서 — 받은 번호 순서대로 1, 2, 3… 이 보고의 줄만 */
export async function reorder(reportId: number, res: string, ids: unknown): Promise<void> {
  await draftReport(reportId);
  const def = RES[res];
  if (!def || !Array.isArray(ids)) throw new ReportError("순서가 올바르지 않습니다.");
  const list = ids.map(Number).filter((n) => Number.isInteger(n));
  for (let i = 0; i < list.length; i++) {
    const owner = await queryOne<{ report_id: number }>(def.reportOf, [list[i]]);
    if (owner?.report_id !== reportId) continue;
    await query(`UPDATE ${def.table} SET sort_order = $2 WHERE id = $1`, [list[i], i + 1]);
  }
}

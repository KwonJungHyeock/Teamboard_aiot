// v3 「구성원」 — 세고 · 막는 규칙 (MD-P-2026-067 §C). 순수 함수다.
//
// ── 왜 화면이 같은 판정을 또 하는가 ─────────────────────────────
//
// 서버는 이미 막는다 — 마지막 관리자를 내리면 400 이다(035 §B-4 · 039 §B-4).
// 그런데 지시서 §C-15 는 **화면에서도 누를 수 없게** 하라고 한다:
// 「못 하는 것을 내놓고 누르면 막는 모양으로 만들지 않는다.」
//
// 그래서 **판정 기준을 서버와 같은 말로** 여기 적는다. 서버는
// `adminWhereSql`(= `role='admin' OR admin_grant`)로 세고, 여기도 그렇게 센다.
// 다르게 세면 화면은 눌리는데 서버가 막거나, 화면이 막는데 서버는 통과한다 —
// 둘 다 「왜 안 되는지」를 사람이 못 읽는 자리가 된다.
//
// **이 파일이 서버를 대신하지 않는다.** 서버의 400 은 그대로 살아 있고,
// 여기는 그 400 을 **미리 보여 주는 것**뿐이다.

/** `/api/members` 가 주는 것 중 이 화면이 쓰는 칸만. */
export interface MemberRow {
  id: number;
  name: string;
  email: string | null;
  role: string;
  adminGrant: boolean;
  isActive: boolean;
}

/** 관리자인가 — **서버의 `adminWhereSql` 과 같은 말이다.** */
export function isAdminRow(m: Pick<MemberRow, "role" | "adminGrant">): boolean {
  return m.role === "admin" || m.adminGrant === true;
}

/** 지금 **활성** 관리자 수. 비활성 계정은 아무 일도 못 하므로 안 센다. */
export function activeAdmins(rows: readonly MemberRow[]): number {
  return rows.filter((m) => m.isActive && isAdminRow(m)).length;
}

/** 팀장 이상 활성 수 — 서버의 `activeLeadCount` 와 같이 **관리자를 포함한다.** */
export function activeLeads(rows: readonly MemberRow[]): number {
  return rows.filter((m) => m.isActive && (m.role === "admin" || m.role === "lead")).length;
}

/** 머리의 두 숫자 (§C-17). **같은 목록에서** 센다 — 「5명 · 활성 5명」. */
export function headCount(rows: readonly MemberRow[]): { total: number; active: number } {
  return { total: rows.length, active: rows.filter((m) => m.isActive).length };
}

/**
 * 이 바꾸기가 **관리자를 0명으로 만드는가.** 서버와 **같은 방식**으로 판정한다.
 *
 * ── 067 에서 틀렸던 자리 ──────────────────────────────────────
 *
 * 처음엔 「관리자가 한 명뿐이면 그 사람의 역할 칸을 통째로 막는다」로 적었다.
 * 그런데 권정혁은 `role='admin'` **이고** `admin_grant=true` 라, 역할만 팀원으로
 * 내려도 **권한으로 관리자가 남는다.** 서버는 「바뀐 뒤 상태를 먼저 만들고 그
 * 상태를 판정」하므로(039 §B) 그 요청을 **통과시켰고**, 화면은 막고 있었다.
 * 검사기가 그 요청을 실제로 보냈다가 로컬 계정의 역할이 바뀌어 드러났다.
 *
 * 화면이 서버의 규칙을 **다른 말로 다시 적으면** 이렇게 갈린다(§G 066). 그래서
 * 이제 서버와 같은 순서로 묻는다 — 바뀐 뒤의 그 사람이 관리자인가, 아니라면
 * 남는 관리자가 있는가.
 */
export function lowersLastAdmin(
  rows: readonly MemberRow[], m: MemberRow, after: { role: string; adminGrant: boolean },
): boolean {
  if (!m.isActive || !isAdminRow(m)) return false;      // 애초에 관리자가 아니다
  if (isAdminRow(after)) return false;                   // 바뀐 뒤에도 관리자다
  return activeAdmins(rows) <= 1;                        // 이 사람이 마지막 한 명이다
}

/** 역할 하나를 고를 수 있는가. 못 고르면 **그 선택지만** 막는다(칸 전체가 아니다). */
export function roleBlocked(rows: readonly MemberRow[], m: MemberRow, role: string): boolean {
  return lowersLastAdmin(rows, m, { role, adminGrant: m.adminGrant });
}

/** 권한을 끌 수 있는가. */
export function grantOffBlocked(rows: readonly MemberRow[], m: MemberRow): boolean {
  return m.adminGrant && lowersLastAdmin(rows, m, { role: m.role, adminGrant: false });
}

/** 못 하는 것이 **하나라도** 있으면 그 이유 한 줄. 서버가 내는 말과 같은 뜻이다. */
export function whyCannotLower(rows: readonly MemberRow[], m: MemberRow): string | null {
  const anyRole = ROLE_CHOICES.some((r) => r !== m.role && roleBlocked(rows, m, r));
  if (!anyRole && !grantOffBlocked(rows, m)) return null;
  return "관리자가 이 한 사람뿐입니다. 다른 사람을 관리자로 올린 뒤에 내릴 수 있습니다.";
}

/**
 * 이 사람을 **비활성으로 바꿀 수 있는가.**
 *
 * 서버가 막는 둘을 그대로 비춘다 — 본인 계정 · 마지막 팀장.
 */
export function whyCannotDeactivate(
  rows: readonly MemberRow[], m: MemberRow, viewerId: number,
): string | null {
  if (!m.isActive) return null;
  if (m.id === viewerId) return "본인 계정은 비활성화할 수 없습니다.";
  if ((m.role === "admin" || m.role === "lead") && activeLeads(rows) <= 1) {
    return "활성 팀장이 1명뿐입니다. 다른 팀장을 지정한 뒤 비활성화하세요.";
  }
  return null;
}

/**
 * 「관리자 권한」 칸을 **그릴 수 있는가.**
 *
 * `role='admin'` 인 사람은 이미 권한이 있고 꺼도 없어지지 않는다 — 서버가
 * 400 으로 거절한다. 그래서 칸을 아예 안 그리고 **이유 한 줄**을 적는다.
 */
export function grantFixedWhy(m: Pick<MemberRow, "role">): string | null {
  return m.role === "admin" ? "역할이 관리자라 항상 권한이 있습니다." : null;
}

/** 화면에 적는 역할 이름. 영문 코드를 사람에게 보이지 않는다. */
export const ROLE_LABEL: Record<string, string> = {
  admin: "관리자", lead: "팀장", member: "팀원", viewer: "보기만",
};

/** 고를 수 있는 역할. **`viewer` 는 안 낸다** — 지금 쓰는 자리가 없다. */
export const ROLE_CHOICES = ["admin", "lead", "member"] as const;

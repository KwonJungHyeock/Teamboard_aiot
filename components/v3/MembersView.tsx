"use client";

// v3 「구성원」 (MD-P-2026-067 §C · 필수 8).
//
// ── 무엇을 하는 자리인가 ────────────────────────────────────────
//
// **관리자 권한을 주고 내리는 자리다.** 이 화면이 막히면 계정을 손볼 길이 없다.
//
// ── 무엇을 먹는가 ──────────────────────────────────────────────
//
// `GET /api/members` · `PUT /api/members/{id}` 둘뿐이다. **새 API 는 없다.**
// 규칙(누구를 못 내리는가)은 `lib/v3/members.ts` 에 있고, 그 기준은 서버가
// 쓰는 것과 같은 말이다 — 화면은 서버의 400 을 **미리 보여 줄** 뿐이다.
//
// ── 사람을 지우지 않는다 (§C-16) ───────────────────────────────
//
// 지우는 자리는 없다. 활성만 끈다 — 지난 업무의 담당자 이름이 사라지면 안 된다.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Empty, Avatar, Button } from "./parts";
import {
  activeAdmins, headCount, whyCannotLower, whyCannotDeactivate, grantFixedWhy,
  roleBlocked, grantOffBlocked, ROLE_LABEL, ROLE_CHOICES, type MemberRow,
} from "@/lib/v3/members";

export default function MembersView({ me }: { me: number }) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [err, setErr] = useState("");
  /** 줄마다 따로 (§G — 한 번에 하나씩). 하나로 묶으면 어느 줄이 거부됐는지 모른다. */
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const r = await fetch("/api/members").catch(() => null);
    if (!r || !r.ok) { setErr(`구성원을 불러오지 못했습니다${r ? ` (${r.status})` : ""}.`); return; }
    const d = await r.json().catch(() => ({}));
    // 이름 칸은 API 가 `displayName` 으로 준다 — **짐작하지 않고 응답에 맞춘다.**
    setRows((d.members ?? []).map((m: {
      id: number; displayName: string; email: string | null; role: string;
      adminGrant: boolean; isActive: boolean;
    }) => ({ id: m.id, name: m.displayName, email: m.email, role: m.role,
             adminGrant: m.adminGrant === true, isActive: m.isActive !== false })));
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** 한 줄을 보낸다. **서버가 준 이유를 그대로 적는다** — 삼키면 같은 것을 반복한다. */
  const send = useCallback(async (id: number, patch: Record<string, unknown>) => {
    setBusy(id);
    setNote((n) => ({ ...n, [id]: "" }));
    const r = await fetch(`/api/members/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setNote((n) => ({ ...n, [id]: d.error ?? `바꾸지 못했습니다 (${r.status})` })); return; }
    await load();
  }, [load]);

  const list = rows ?? [];
  const head = useMemo(() => headCount(list), [list]);
  const admins = useMemo(() => activeAdmins(list), [list]);

  return (
    <>
      <h1 className="v3-h1">구성원</h1>
      {/* 두 숫자는 **같은 목록에서** 센다 (§C-17 · 066 §D 에서 배운 것) */}
      <p className="v3-lede">
        {rows === null ? "불러오는 중…" : `${head.total}명 · 활성 ${head.active}명 · 관리자 ${admins}명`}
      </p>

      {err && <Card><p className="v3-err">{err}</p></Card>}

      {rows === null ? <Card><p className="v3-loading">불러오는 중…</p></Card>
        : list.length === 0 ? (
          <Card><Empty title="구성원이 없어요" why="계정이 하나도 없습니다. 이 상태는 정상이 아닙니다 — 관리자에게 알리세요." /></Card>
        ) : (
          <Card>
            {list.map((m) => {
              const lowerWhy = whyCannotLower(list, m);
              const offWhy = whyCannotDeactivate(list, m, me);
              const fixed = grantFixedWhy(m);
              return (
                <div className={`v3-mem${m.isActive ? "" : " off"}`} key={m.id}>
                  <Avatar name={m.name} />
                  <span className="v3-row-main">
                    <span className="v3-row-t">{m.name}</span>
                    {/* 이메일은 **합칠 때의 열쇠다**(§F) — 비어 있으면 그렇게 적는다 */}
                    <span className="v3-row-sub">{m.email || "이메일 없음"}</span>
                  </span>

                  {/* 역할 — 관리자만 만진다. `requireLiveAdmin` 이 서버에서도 막는다 */}
                  <select className="v3-mem-role" aria-label={`${m.name} 역할`}
                          value={m.role} disabled={busy === m.id}
                          onChange={(e) => void send(m.id, { role: e.target.value })}>
                    {/* 칸 전체가 아니라 **관리자를 0명으로 만드는 선택지만** 막는다.
                        서버와 같은 방식(바뀐 뒤 상태)으로 판정한다 */}
                    {ROLE_CHOICES.map((r) => (
                      <option key={r} value={r} disabled={r !== m.role && roleBlocked(list, m, r)}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>

                  {/* 모두관리자 — `role='admin'` 이면 칸을 **안 그리고 이유를 적는다** */}
                  {fixed ? (
                    <span className="v3-mem-fixed" title={fixed}>권한 고정</span>
                  ) : (
                    <label className="v3-mem-grant">
                      <input type="checkbox" checked={m.adminGrant}
                             disabled={busy === m.id || grantOffBlocked(list, m)}
                             aria-label={`${m.name} 관리자 권한`}
                             onChange={(e) => void send(m.id, { adminGrant: e.target.checked })} />
                      관리자 권한
                    </label>
                  )}

                  {/* 활성 — **지우지 않는다**(§C-16). 끄고 켜는 것만 있다 */}
                  <Button className="v3-mem-act"
                          disabled={busy === m.id || (m.isActive && offWhy !== null)}
                          title={m.isActive ? (offWhy ?? "비활성으로 바꿉니다") : "다시 활성으로 바꿉니다"}
                          onClick={() => void send(m.id, { isActive: !m.isActive })}>
                    {m.isActive ? "활성" : "비활성"}
                  </Button>

                  {/* 못 누르는 자리에는 **왜인지** 적는다 — 안 적으면 고장으로 읽힌다 */}
                  {(lowerWhy || offWhy || note[m.id]) && (
                    <p className="v3-mem-why">
                      {note[m.id] || lowerWhy || offWhy}
                    </p>
                  )}
                </div>
              );
            })}
          </Card>
        )}

      <p className="v3-why">
        사람을 지우는 자리는 없습니다. 비활성으로 바꾸면 목록과 새 배정에서 빠지고,
        지난 업무에 남은 이름은 그대로 있습니다.
      </p>
    </>
  );
}

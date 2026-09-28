"use client";

// 새 화면 스위치 (MD-P-2026-074 §A).
//
// ── 확인을 받는다 (§A-5) ─────────────────────────────────────────
//
// 070 §G 는 「확인 창 대신 되돌리기」다. 이것은 그 **예외**다 — 누르는 순간 **모든 사람의**
// 화면이 바뀌고, 토스트의 「되돌리기」로 덮을 수 없다. 그래서 바로 바꾸지 않고, **무엇이
// 일어나는지**를 적은 한 줄을 보여 준 뒤 한 번 더 받는다.
//
// ── 끈 뒤에 어디로 가나 (§A-6) ────────────────────────────────────
//
// 끄자마자 새 화면은 전부 막힌다. 그대로 두면 막음 화면을 보게 된다. 그래서 **옛 「설정」**
// 으로 보낸다 — 옛 화면이고, 거기 다시 켜는 버튼이 있다. 켠 뒤에는 새 대시보드로 간다.
import { useState } from "react";
import { Card, Button } from "./parts";

/** §A-5 문구 그대로 */
export const OFF_LINE = "새 화면이 꺼지고 모두가 옛 화면으로 돌아갑니다";
export const ON_LINE = "새 화면이 켜지고 모두가 새 화면으로 옮겨 갑니다";
/** 끈 뒤 · 켠 뒤 가는 곳 */
export const AFTER_OFF = "/settings";
export const AFTER_ON = "/v3";

export default function SwitchView({ on }: { on: boolean }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function apply() {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/settings/platform", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uiV3: !on }),
    }).catch(() => null);
    if (!r || !r.ok) {
      const d = r ? await r.json().catch(() => ({})) : {};
      setErr(String((d as { error?: string }).error ?? "바꾸지 못했습니다. 다시 눌러 주세요."));
      setBusy(false);
      return;
    }
    // 화면 전체를 새로 받는다 — 스위치는 뿌리가 요청마다 읽는다
    window.location.href = on ? AFTER_OFF : AFTER_ON;
  }

  return (
    <>
      <h1 className="v3-h1">새 화면 스위치</h1>
      <p className="v3-lede">모든 사람에게 한꺼번에 걸립니다. 관리자만 보는 자리입니다.</p>
      <Card title="지금" sub={on ? "켜짐" : "꺼짐"}>
        <p className="v3-why" data-switch-state={on ? "on" : "off"}>
          {on ? "모든 사람이 새 화면을 봅니다." : "모든 사람이 옛 화면을 봅니다."}
        </p>
        {!asking ? (
          <Button primary={!on} onClick={() => setAsking(true)} data-switch-act="">
            {on ? "새 화면 끄기" : "새 화면 켜기"}
          </Button>
        ) : (
          <div className="v3-switch-ask" role="alertdialog" aria-label="확인">
            <p className="v3-why"><b>{on ? OFF_LINE : ON_LINE}</b></p>
            <Button primary onClick={apply} disabled={busy} data-switch-yes="">
              {busy ? "바꾸는 중…" : on ? "끄기" : "켜기"}
            </Button>{" "}
            <Button onClick={() => setAsking(false)} disabled={busy}>취소</Button>
          </div>
        )}
        {err && <p className="v3-err">{err}</p>}
      </Card>
    </>
  );
}

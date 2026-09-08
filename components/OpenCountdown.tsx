"use client";

// 가오픈 카운트다운 — 대문 (MD-P-2026-033 §A).
//
// ── 오픈 전만 만든다 ─────────────────────────────────────────────
//
// 오픈 뒤에는 이 자리에 **판매 수량과 활성 지수**가 들어온다. 지금 그것을
// 자리표시로 그려 두지 않는다 — 가짜 숫자는 진짜처럼 보이고, 진짜가 오기 전에
// 누군가 그것을 근거로 말한다. 오픈 뒤에는 **「지났다」만 적고 자리를 비워 둔다.**
//
// ── 하이드레이션 ────────────────────────────────────────────────
//
// 서버와 클라이언트의 시계가 다르므로 SSR 에서 초를 그리면 어긋난다.
// `NowStamp`(HomeView) 와 같은 방식으로 **첫 렌더는 자리표시, mount 후 실제 값**이다.
// 서버는 목표 시각만 준다 — 남은 시간은 보는 사람의 시계가 센다.
import { useEffect, useState } from "react";
import { dDay, pad2, remainUntil, type Remain } from "@/lib/countdown";

const KST = "Asia/Seoul";

export default function OpenCountdown({ openAt, isDefault }: {
  openAt: string;
  /** `config` 에 값이 없어 기본값으로 그리는 중인가 — 팀장에게만 알린다. */
  isDefault?: boolean;
}) {
  const target = Date.parse(openAt);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!Number.isFinite(target)) return null;

  const label = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST, year: "numeric", month: "long", day: "numeric", weekday: "short",
  }).format(new Date(target));

  // mount 전 — 숫자 자리를 **같은 폭으로** 비워 둔다. 값이 들어올 때 레이아웃이
  // 흔들리지 않는다.
  const r: Remain | null = now === null ? null : remainUntil(target, now);
  const d = now === null ? null : dDay(target, now, KST);

  if (r?.past) {
    return (
      <section className="oc oc-past" aria-label="가오픈">
        <span className="oc-cap">가오픈</span>
        <strong className="oc-done">시작됨</strong>
        <span className="oc-when">{label}</span>
      </section>
    );
  }

  const unit = (v: number | null, u: string, key: string) => (
    <span className="oc-u" key={key}>
      <b className="num">{v === null ? "--" : pad2(v)}</b>
      <em>{u}</em>
    </span>
  );

  return (
    <section className="oc" aria-label="가오픈까지 남은 시간">
      <div className="oc-l">
        <span className="oc-cap">가오픈까지</span>
        {/* D-표기는 **달력 날짜 차이**다. 남은 밀리초를 나누면 시각에 따라 하루가
            어긋나 자료의 D-55 와 안 맞는다(lib/countdown.ts). */}
        <strong className="oc-d num">{d === null ? "D-–" : d > 0 ? `D-${d}` : "D-DAY"}</strong>
      </div>
      <div className="oc-r">
        <div className="oc-clock" role="timer" aria-live="off">
          {unit(r?.days ?? null, "일", "d")}
          {unit(r?.hours ?? null, "시", "h")}
          {unit(r?.minutes ?? null, "분", "m")}
          {unit(r?.seconds ?? null, "초", "s")}
        </div>
        <span className="oc-when">
          {label} 00:00 KST
          {isDefault && <em className="oc-def"> · 아직 설정 안 됨 (설정에서 지정)</em>}
        </span>
      </div>
    </section>
  );
}

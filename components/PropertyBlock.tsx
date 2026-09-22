"use client";

// 속성 블록 (MD-P-2026-019 §F1) — 라벨(88px) + 값의 한 줄 그리드.
// 값은 그 자리에서 편집한다. 화면 이동 없음.
// 비어 있으면 빈칸이 아니라 "＋ 목표 연결" 같은 행동 문구를 보여준다.
import { useEffect, useState, type ReactNode } from "react";

export interface PropRow {
  key: string;
  label: string;
  /** 값이 있으면 이 노드를 그린다 */
  value: ReactNode;
  /** 값이 비었는지 — true 면 action 문구를 대신 그린다 */
  empty?: boolean;
  /** 비었을 때 보여줄 행동 문구 (예: "＋ 목표 연결") */
  action?: string;
  /** 클릭 시 열리는 편집기. 없으면 읽기 전용 행 */
  editor?: (close: () => void) => ReactNode;
  /**
   * **이 값은 스스로 눌린다** (064 §A-1).
   *
   * 값 안에 제 버튼이 들어 있다는 뜻이다(예: 「상위 업무」의 `#12 제목` 링크).
   * 켜면 값을 `<button>` 으로 **감싸지 않고**, 값과 편집 버튼을 형제로 둔다.
   *
   * 이 블록은 건네받은 노드 속을 **안 들여다본다.** 값이 어떻게 생겼는지는
   * 건네준 쪽이 안다 — 여기서 알아내려 하면 그때부터 틀린다(§G 063).
   * 기본값은 꺼짐이라 다른 줄은 한 곳도 안 바뀐다.
   */
  valueActs?: boolean;
}

export default function PropertyBlock({
  rows,
  /** 이 개수를 넘는 분은 접을 수 있다 (MD-P-2026-020 §F1: 5개 초과분) */
  collapseAfter = 5,
  /** 기본 펼침 (§F1). false 면 처음부터 접힌 채로 시작한다 */
  defaultExpanded = true,
}: {
  rows: PropRow[];
  collapseAfter?: number;
  defaultExpanded?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);

  /**
   * 팝오버가 열려 있으면 **Esc 는 팝오버만 닫는다.**
   *
   * 이게 없어서, 새 업무 모달에서 목표를 고르려고 팝오버를 연 뒤 Esc 를 누르면
   * **작성 중이던 업무가 통째로 닫혔다.** 모달이 `window` 에 Esc 리스너를 달고
   * 있는데 팝오버는 아무것도 안 잡고 있었기 때문이다.
   *
   * `capture: true` 로 단다 — 같은 `window` 의 버블 리스너(모달)보다 **먼저** 돌아야
   * 막을 수 있다. 열려 있을 때만 단다. 안 열렸을 때까지 Esc 를 가로채면
   * 모달을 Esc 로 닫을 수가 없다.
   */
  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setOpenKey(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openKey]);

  const shown = expanded ? rows : rows.slice(0, collapseAfter);
  const hidden = rows.length - shown.length;

  return (
    <div className="prop">
      {shown.map((r) => (
        <div className={`prop-row${openKey === r.key ? " open" : ""}`} key={r.key}>
          <span className="prop-l">{r.label}</span>
          {/*
            ── 064 §A — 값이 스스로 눌리는 줄은 **감싸지 않는다** ──────────
            값 안에 버튼이 있는데 값을 또 `<button>` 으로 감싸면 `<button>` 안의
            `<button>` 이 된다. 눌렀을 때 두 가지가 같이 일어나고(「차단」 줄은
            실제로 그랬다 — 그 업무로 가면서 편집기도 열렸다), 하이드레이션
            경고도 난다.

            바깥을 `div[role=button]` 으로 바꾸거나 안쪽 버튼을 `<a>` 로 바꾸지
            않는다. 그건 경고만 끄고 병은 남긴다(§G 063).

            **B-15(031 §E3)와 같은 짜임이다** — 분기 헤더가 같은 병이었고,
            거기서 `div.qsec-h` 로 감싸고 접기 버튼과 제목 버튼을 형제로 뒀다.
            집안에 답이 있으면 두 번째 답을 만들지 않는다.

            편집 버튼은 **남는 폭을 다 채운다**(`.prop-edit { flex: 1 }`).
            063 이 잰 바로 그 자리다 — 「상위 업무」 294px · 「차단」 279px 이
            편집기가 열리던 폭이었다. 좁은 손잡이로 바꾸면 고친 게 아니라
            사람 손이 가던 자리를 옮긴 것이다.

            비어 있을 때(`empty`)는 값이 「＋ 지정」 글자뿐이라 안에 버튼이 없다.
            그때는 예전처럼 통째로 감싼다 — 나눌 것이 없다.
          */}
          {r.editor && r.valueActs && !r.empty ? (
            <span className="prop-v">
              {r.value}
              <button
                className="prop-edit"
                aria-expanded={openKey === r.key}
                aria-label={`${r.label} 편집`}
                onClick={() => setOpenKey(openKey === r.key ? null : r.key)}
              />
            </span>
          ) : r.editor ? (
            <button
              className={`prop-v${r.empty ? " empty" : ""}`}
              aria-expanded={openKey === r.key}
              onClick={() => setOpenKey(openKey === r.key ? null : r.key)}
            >
              {r.empty ? (r.action ?? "＋ 지정") : r.value}
            </button>
          ) : (
            <span className={`prop-v ro${r.empty ? " empty" : ""}`}>{r.empty ? (r.action ?? "—") : r.value}</span>
          )}
          {openKey === r.key && r.editor && (
            <div className="prop-pop" role="dialog" aria-label={`${r.label} 편집`}>
              {r.editor(() => setOpenKey(null))}
            </div>
          )}
        </div>
      ))}
      {hidden > 0 && (
        <button className="prop-more" onClick={() => setExpanded(true)}>속성 더보기 {hidden}개</button>
      )}
      {expanded && rows.length > collapseAfter && (
        <button className="prop-more" onClick={() => setExpanded(false)}>속성 접기</button>
      )}
    </div>
  );
}

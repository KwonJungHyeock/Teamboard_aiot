"use client";

// 미션덱 v3 — 기본 부품 (MD-P-2026-042 §A).
//
// 066 §C-1 에서 `Menu`(여닫는 고르개)가 들어오면서 이 파일에 처음 상태가
// 생겼다. 그래서 `"use client"` 를 붙였다 — 여덞 화면 전부가 이미 클라이언트
// 부품이라 **닿는 범위가 바뀌지 않는다.**
//
// ── 규칙 두 개 ──────────────────────────────────────────────────
//
//   1. **값을 여기 쓰지 않는다.** 색·치수는 전부 `app/v3.css` 의 토큰이다.
//      이 파일에 `#2F6FED` 나 `64px` 이 나타나면 그건 결함이다.
//   2. **색은 태그와 상태에만.** 글자와 선은 회색 세 단계뿐이다.
//
// 부품이 한 파일에 모여 있는 이유: 지금은 열 개고 서로 붙어 다닌다.
// 파일을 열 개로 쪼개면 무엇이 있는지 보려고 매번 폴더를 훑어야 한다.
// 늘어나면 그때 쪼갠다.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AreaView } from "@/lib/v3/category";
import type { DueTone } from "@/lib/v3/tasks";

/* ── Tag ─────────────────────────────────────────────────────────
   색이 허용된 두 자리 중 하나. 카테고리와 상태만 색을 갖는다.

   **이름을 보고 색을 정하지 않는다.** 색은 서버가 이미 풀어서 `tone` 으로
   넘겨 준 값이다(`lib/v3/category.ts`). 팔레트에 없는 영역은 `etc` 색으로
   오지만 **이름은 그대로 그린다** — 색이 없다고 이름까지 지우면 그 업무가
   어디 것인지 사라진다. */
export function Tag({ area }: { area: AreaView }) {
  return <span className={`v3-tag ${area.tone}`}>{area.name}</span>;
}
export function StateTag({ tone, children }: { tone: "warn" | "late"; children: React.ReactNode }) {
  return <span className={`v3-tag ${tone}`}>{children}</span>;
}

/* ── Avatar ──────────────────────────────────────────────────────
   042 에서는 담당이 없으면 **점선 ＋** 를 그렸다. 046 §0 에서 지시자가 그 표시를
   거뒀다 — 「담당 없음은 이 API 에서 만들 수 없는 상태」라는 이유였다.

   조사해 보면 절반만 그렇다(§B-1 보고):
     · `POST /api/tasks` 는 **못 만든다** — `payload.assigneeId ? … : session.id`
     · `PATCH /api/tasks/{id}` 는 **만들 수 있다** — `assigneeId: null` 이 그대로 간다

   그래서 ＋ 는 지우되(v3 에는 담당을 비우는 자리가 없으므로 눌러도 갈 데가
   없는 자리였다) **없는 것을 없다고 말하는 자리**는 남긴다: 목록에서는 아바타
   칸이 비고, 상세에서는 「담당 없음」이 글자로 선다. 빈 동그라미로 거짓말하지
   않고, 누를 수 없는 ＋ 로 부르지도 않는다. */
export function Avatar({ name }: { name: string | null }) {
  if (!name) return null;
  return <span className="v3-av" title={name} aria-label={name}>{name.slice(0, 1)}</span>;
}

/* ── Button ──────────────────────────────────────────────────────── */
export function Button({
  primary, children, ...rest
}: { primary?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest} className={`v3-btn${primary ? " primary" : ""}${rest.className ? ` ${rest.className}` : ""}`}>{children}</button>;
}

/* ── Chip ────────────────────────────────────────────────────────
   카테고리 거르개는 **줄**이다. 사이드바가 아니다 — 「어디로 갈까」가 아니라
   「무엇을 볼까」이기 때문이다. */
export function Chip({
  on, count, dashed, children, ...rest
}: { on?: boolean; count?: number; dashed?: boolean; children: React.ReactNode }
  & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} type="button" aria-pressed={on ? "true" : "false"}
            className={`v3-chip${dashed ? " dashed" : ""}`}>
      {children}
      {count !== undefined && <span className="v3-chip-n">{count}</span>}
    </button>
  );
}

/* ── InputChip — 거르개가 아니라 **입력**이다 (MD-P-2026-046 §A) ──

   같은 알약 모양을 두 가지 일에 쓰고 있었다. 그래서 새 업무의 「담당 · 권정혁」이
   **골라진 필터**처럼 검게 채워졌다 — 거르개에서 검정 채움은 「이걸로 걸렀다」는
   뜻인데, 여기서는 아무것도 안 골랐고 그냥 값이 들어 있을 뿐이다.

   두 종류를 가른다. 거르개(`Chip`)는 검정 채움을 그대로 쓰고, 입력은 안 쓴다.

     값 없음·접힘   점선 테두리 · 회색 글자        「아직 안 정했다」
     펼침           실선 테두리 진하게 · 흰 바탕   「지금 고르는 중」
     값 있음        연한 바탕 + 진한 글자          「정해져 있다」  (태그와 같은 결)

   `aria-pressed` 가 아니라 `aria-expanded` 다. 이건 고른 상태가 아니라 **여닫는
   자리**이고, 두 낱말을 섞으면 스크린리더가 「선택됨」이라고 읽는다. */
export function InputChip({
  open, filled, children, ...rest
}: { open?: boolean; filled?: boolean; children: React.ReactNode }
  & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} type="button" aria-expanded={open ? "true" : "false"}
            className={`v3-ichip${filled ? " filled" : ""}${open ? " open" : ""}`}>
      {children}
    </button>
  );
}

/* ── Card ────────────────────────────────────────────────────────── */
/* ── PropRow — 속성 한 줄 (MD-P-2026-066 §E-37 · §E-39) ─────────────

   옛 상세 패널의 `PropertyBlock` 과 **같은 뜻**을 v3 에 둔다. 064 §A 에서
   거기 고친 것을 여기서 다시 만들지 않기 위해서다.

   ── `valueActs` 가 무엇인가 ─────────────────────────────────────

   대부분의 줄은 **값 전체가 여는 단추**다(누르면 고르개가 펼친다). 그런데
   상위·하위처럼 **값이 스스로 눌리는** 줄이 있다 — 값이 링크라서 누르면 그
   업무로 간다. 그 줄에서 값을 단추로 감싸면 **버튼 안 버튼**이 되고(B-15),
   감싸지 않으면 편집할 자리가 사라진다.

   그래서 064 §A 의 모양을 그대로 쓴다: 값과 편집 손잡이를 **형제**로 두고,
   손잡이가 값이 안 덮은 자리를 끝까지 덮는다. 눌리는 폭이 줄지 않는다. */
export function PropRow({
  label, valueActs, editing, onEdit, children, editor,
}: {
  label: string;
  /** 값이 스스로 눌리는 줄인가 (상위·하위). 형제 모양으로 그린다 */
  valueActs?: boolean;
  editing?: boolean;
  /** 없으면 **읽기 전용 줄**이다 — 누를 수 없는 단추로 부르지 않는다 */
  onEdit?: () => void;
  children: React.ReactNode;
  /** 펼쳤을 때 아래에 서는 고르개 */
  editor?: React.ReactNode;
}) {
  return (
    <div className="v3-prop" data-k={label}>
      <span className="v3-prop-k">{label}</span>
      {onEdit === undefined ? (
        <span className="v3-prop-v ro">{children}</span>
      ) : valueActs ? (
        <span className="v3-prop-v">
          {children}
          {/* 값이 안 덮은 자리를 **끝까지** 덮는다. 형제라서 버튼 안 버튼이 아니다 */}
          <button type="button" className="v3-prop-edit" aria-expanded={editing === true}
                  aria-label={`${label} 편집`} onClick={onEdit} />
        </span>
      ) : (
        <button type="button" className="v3-prop-v act" aria-expanded={editing === true}
                onClick={onEdit}>
          {children}
        </button>
      )}
      {editing && editor !== undefined && <div className="v3-prop-ed">{editor}</div>}
    </div>
  );
}

/* ── Menu — 「가끔 쓰는 것」의 자리 (MD-P-2026-066 §C-1 · §C-16 · §C-17) ──

   §C-16 의 뒷말이 이것이다: 자주 하는 것은 한 번에 닿는 칩으로, **가끔 쓰는
   것은 골라서.** 영역 일곱 · 사람 다섯 · 기한 넷을 전부 칩으로 깔면 거르개 줄이
   열여섯 알이 되고, 그러면 지금 무엇이 걸려 있는지를 사람이 셀 수 없다.
   못 세면 빈 목록이 고장으로 읽힌다.

   §C-17: 사람이 늘어도 **줄의 모양이 안 바뀐다.** 담당을 탭으로 깔면 사람이
   들어올 때마다 화면이 달라진다.

   여는 단추와 항목들은 **형제**다 — 단추가 목록을 품으면 버튼 안 버튼이 된다
   (B-15 선례 · 064 §A 와 같은 모양). */
export function Menu({
  label, value, children,
}: { label: string; value?: string | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  /*
   * 밖을 누르면 닫힌다. `mousedown` 으로 듣는 이유: `click` 으로 들으면
   * 안쪽 항목의 클릭보다 먼저 닫혀서 **고른 값이 안 들어가는** 때가 있다.
   */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="v3-menu" ref={box}>
      {/* 걸린 값을 **단추에 적는다.** 안 적으면 접힌 동안 무엇이 걸렸는지가
          화면에서 사라진다 — 열어 봐야 아는 조건은 없는 조건과 같다. */}
      <button type="button" className={`v3-mbtn${value ? " on" : ""}`}
              aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
        {value && <b className="v3-mbtn-v">{value}</b>}
        <span className="v3-mbtn-cv" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="v3-mpop" role="group" aria-label={label}>{children}</div>
      )}
    </div>
  );
}

/** 고르개 한 줄. 눌리는 자리이므로 버튼이고, **골라졌음을 글자로도** 남긴다. */
export function MenuItem({
  on, count, children, ...rest
}: { on?: boolean; count?: number; children: React.ReactNode }
  & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} type="button" aria-pressed={on ? "true" : "false"}
            className={`v3-mitem${on ? " on" : ""}`}>
      <span className="v3-mitem-k" aria-hidden="true">{on ? "✓" : ""}</span>
      <span className="v3-mitem-t">{children}</span>
      {count !== undefined && <span className="v3-chip-n">{count}</span>}
    </button>
  );
}

export function Card({
  title, sub, children, ...rest
}: { title?: string; sub?: React.ReactNode; children: React.ReactNode }
  & React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className={`v3-card${rest.className ? ` ${rest.className}` : ""}`}>
      {title && (
        <div className="v3-card-h">
          <h2>{title}</h2>
          {sub && <span className="v3-sub">{sub}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/* ── StatTile ────────────────────────────────────────────────────
   「기한 없음」만 호박색이다 — 아무 날에도 안 걸려서 마지막까지 안 보이는
   것들이라, 세 숫자 중 그것만 손댈 일이 남아 있다는 뜻이다. */
export function StatTile({
  n, label, warn, late, sub, href,
}: {
  n: number; label: string; warn?: boolean;
  /** 066 §D-30 — **기한 지남만** 색을 준다. 나머지는 무채색이다 */
  late?: boolean;
  /** 숫자 아래 한 줄 (「진행 4 · 검토 2」 같은 것). 없으면 안 그린다 */
  sub?: string;
  /** 누르면 **같은 조건의 목록**으로 간다 (§D-35 가 그 값끼리 맞춰 본다) */
  href?: string;
}) {
  const inner = (
    <>
      <span className="v3-stat-n">{n}</span>
      <span className="v3-stat-l">{label}</span>
      {sub && <span className="v3-stat-s">{sub}</span>}
    </>
  );
  const cls = `v3-stat${warn ? " warn" : ""}${late ? " late" : ""}`;
  // 누를 수 있는 자리면 링크다. 아니면 그냥 칸이다 — 안 눌리는 것을 링크처럼
  // 그리지 않는다.
  return href ? <Link className={`${cls} act`} href={href}>{inner}</Link>
              : <div className={cls}>{inner}</div>;
}

/* ── Checkbox — 상태 네 가지 ─────────────────────────────────────
   할 일 · 진행 중 · 검토 중 · 완료. 네모 하나로 넷을 말한다 —
   상태 이름을 행마다 글자로 적으면 64px 행이 금세 빽빽해진다. */
export type CbState = "todo" | "doing" | "review" | "done";
const CB_LABEL: Record<CbState, string> = {
  todo: "아직 시작 안 함", doing: "진행 중", review: "검토 중", done: "완료",
};
/*
 * ── 누를 수 없을 때는 **버튼이 아니다** (059 §B ⑥) ────────────────
 *
 * 상세의 상태 고르개는 `<button class="v3-stbtn">` 안에 이 네모를 넣는다.
 * 안쪽도 `<button>` 이면 HTML 이 금지하는 **버튼 안 버튼**이고, React 가
 * 하이드레이션 경고를 낸다 — 상세를 열 때마다 한 번씩. 046 §B 부터 있었다.
 *
 * 누르는 자리(`onToggle` 이 온 자리)는 그대로 버튼이다. 아무도 안 누르는
 * 자리는 그냥 **모양**이므로 `<span role="img">` 로 낸다. 글자 설명은 양쪽 다
 * 그대로 붙는다 — 모양만으로는 배워야 알 수 있다.
 *
 * 지금 v3 에서 `onToggle` 을 주는 자리는 없다(전부 `disabled` 인 버튼이었다).
 * 그래서 이 바꾸기로 **없어지는 동작이 없다.**
 */
export function Checkbox({
  state, onToggle, disabled,
}: { state: CbState; onToggle?: () => void; disabled?: boolean }) {
  const mark = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
  if (!onToggle) {
    return (
      <span className={`v3-cb mark ${state}`} role="img"
            title={CB_LABEL[state]} aria-label={CB_LABEL[state]}>
        {mark}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`v3-cb ${state}`}
      disabled={disabled}
      onClick={onToggle}
      aria-pressed={state === "done" ? "true" : "false"}
      // 상태를 **글자로도** 남긴다. 모양만으로는 배워야 알 수 있다.
      title={CB_LABEL[state]}
      aria-label={CB_LABEL[state]}
    >
      {mark}
    </button>
  );
}

/* ── Clip — 첨부가 있다는 표시 (051 §C-3) ────────────────────────
   **목록에 썸네일을 안 그린다.** 그림이 행마다 붙으면 화면이 무거워지고,
   목록에서 그림을 보고 할 수 있는 판단도 없다. 있다는 사실과 개수만 낸다. */
export function Clip({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="v3-clip" title={`첨부 ${n}개`} aria-label={`첨부 ${n}개`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.19a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 1 1-2.59-2.6l8.5-8.49" />
      </svg>
      {n}
    </span>
  );
}

/* ── ListRow ─────────────────────────────────────────────────────
   **행에 네 가지만.** 체크 · 제목 · 담당 · 기한.
   ID · 우선순위 · 진척 막대는 목록에 넣지 않는다(지시 §C-2) — 상세에 있다.
   하위가 있을 때만 제목 아래 한 줄이 붙는다. */
export function ListRow({
  href, title, sub, state, assignee, due, late, dueTone, clip, onToggle,
  selected, onSelect,
}: {
  href: string;
  title: string;
  /** 첨부 개수. 0이면 아무것도 안 그린다 — 썸네일은 목록에 없다 (051 §C-3). */
  clip?: number;
  /** 하위가 있을 때만. 예: 「하위 2개 중 1개 완료」 */
  sub?: string | null;
  state: CbState;
  assignee: string | null;
  /** 이미 만들어진 표시 문자열. 없으면 회색 이탤릭 「기한 없음」. */
  due: string | null;
  /** 왼쪽 코랄 테두리. **7일 이내로 지난 것에만** 붙는다 (044 §A·§B). */
  late?: boolean;
  /** 기한 글자의 결. 안 주면 `late` 만 보고 정한다. */
  dueTone?: DueTone;
  onToggle?: () => void;
  /*
   * ── 고르기 (057 §B) ───────────────────────────────────────────
   * `onSelect` 를 주는 화면에서만 선택 상자가 선다. 안 주면 이 행은 예전 그대로다 —
   * 「오늘」·「팀 현황」이 갑자기 고를 수 있게 되지 않는다.
   */
  selected?: boolean;
  onSelect?: () => void;
}) {
  /*
   * `x` 로도 고른다(지시 §B). 행 안에서 키를 받되 **입력 칸에서는 안 걸린다** —
   * 제목에 x 를 못 치게 되면 그건 단축키가 아니라 고장이다. 051 의 `C` 와 같은 결.
   */
  const key = (e: React.KeyboardEvent) => {
    if (!onSelect) return;
    if (e.key !== "x" && e.key !== "X" && e.key !== "ㅌ") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return;
    e.preventDefault();
    onSelect();
  };
  return (
    <div className={`v3-row${late ? " late" : ""}${state === "done" ? " done" : ""}${selected ? " picked" : ""}`}
         onKeyDown={onSelect ? key : undefined}>
      {onSelect && (
        /* 상태 네모(`.v3-cb`)와 **다르게 생겨야 한다.** 하나는 「이 업무가 어떤
           상태인가」, 하나는 「내가 이것을 골랐는가」다. 한 모양이 둘을 말하면
           안 된다(§G 047). 그래서 여기는 브라우저 기본 체크상자를 쓴다. */
        <input type="checkbox" className="v3-pick" checked={selected ?? false}
               onChange={onSelect} aria-label={`${title} 고르기`} />
      )}
      <Checkbox state={state} onToggle={onToggle} disabled={!onToggle} />
      <span className="v3-row-main">
        <Link className="v3-row-t" href={href}>{title}</Link>
        {sub && <span className="v3-row-sub">{sub}</span>}
      </span>
      <span className="v3-row-r">
        <Clip n={clip ?? 0} />
        <Avatar name={assignee} />
        <DueText due={due} late={late} tone={dueTone} />
      </span>
    </div>
  );
}

/**
 * 기한 글자.
 *
 * · 없음 → **회색 이탤릭** 「기한 없음」. 빈칸으로 두면 줄이 무너져 보인다
 * · 지남 7일 이내 → 코랄
 * · 지남 7일 초과 → **회색으로 눕힌다.** 여기까지 코랄로 칠하면 목록 절반이
 *   빨개지고, 그러면 정작 급한 것이 안 보인다 (044 §B — 오늘 화면과 같은 기준)
 */
export function DueText({ due, late, tone }: { due: string | null; late?: boolean; tone?: DueTone }) {
  if (!due) return <em className="v3-due none">기한 없음</em>;
  const cls = tone ?? (late ? "late" : "plain");
  return <span className={`v3-due t-${cls}`}>{due}</span>;
}

/* ── EmptyState ──────────────────────────────────────────────────
   **이유와 다음 행동을 적는다** (SYSTEMFLOW 8-4).
   「없습니다」만 적으면 사람은 고장인지 비어 있는 건지 모른다. */
export function Empty({
  title, why, action,
}: { title: string; why: string; action?: { label: string; href: string } }) {
  return (
    <div className="v3-empty">
      <b>{title}</b>
      <p>{why}</p>
      {action && <Link className="v3-btn" href={action.href}>{action.label}</Link>}
    </div>
  );
}

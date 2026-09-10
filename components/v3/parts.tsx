// 미션덱 v3 — 기본 부품 (MD-P-2026-042 §A).
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
import type { AreaView } from "@/lib/v3/category";

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
   담당이 없으면 빈칸이 아니라 **점선 ＋** 다. 빈칸은 「아직 안 불러왔나」로
   읽히고, 점선 자리는 「비어 있다」로 읽힌다. */
export function Avatar({ name }: { name: string | null }) {
  if (!name) return <span className="v3-av none" title="담당 없음" aria-label="담당 없음">＋</span>;
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

/* ── Card ────────────────────────────────────────────────────────── */
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
export function StatTile({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div className={`v3-stat${warn ? " warn" : ""}`}>
      <span className="v3-stat-n">{n}</span>
      <span className="v3-stat-l">{label}</span>
    </div>
  );
}

/* ── Checkbox — 상태 네 가지 ─────────────────────────────────────
   할 일 · 진행 중 · 검토 중 · 완료. 네모 하나로 넷을 말한다 —
   상태 이름을 행마다 글자로 적으면 64px 행이 금세 빽빽해진다. */
export type CbState = "todo" | "doing" | "review" | "done";
const CB_LABEL: Record<CbState, string> = {
  todo: "아직 시작 안 함", doing: "진행 중", review: "검토 중", done: "완료",
};
export function Checkbox({
  state, onToggle, disabled,
}: { state: CbState; onToggle?: () => void; disabled?: boolean }) {
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
  );
}

/* ── ListRow ─────────────────────────────────────────────────────
   **행에 네 가지만.** 체크 · 제목 · 담당 · 기한.
   ID · 우선순위 · 진척 막대는 목록에 넣지 않는다(지시 §C-2) — 상세에 있다.
   하위가 있을 때만 제목 아래 한 줄이 붙는다. */
export function ListRow({
  href, title, sub, state, assignee, due, late, onToggle,
}: {
  href: string;
  title: string;
  /** 하위가 있을 때만. 예: 「하위 2개 중 1개 완료」 */
  sub?: string | null;
  state: CbState;
  assignee: string | null;
  /** 이미 만들어진 표시 문자열. 없으면 회색 이탤릭 「기한 없음」. */
  due: string | null;
  late?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className={`v3-row${late ? " late" : ""}${state === "done" ? " done" : ""}`}>
      <Checkbox state={state} onToggle={onToggle} disabled={!onToggle} />
      <span className="v3-row-main">
        <Link className="v3-row-t" href={href}>{title}</Link>
        {sub && <span className="v3-row-sub">{sub}</span>}
      </span>
      <span className="v3-row-r">
        <Avatar name={assignee} />
        <DueText due={due} late={late} />
      </span>
    </div>
  );
}

/** 기한 없음은 **회색 이탤릭**이다 — 빈칸으로 두면 줄이 무너져 보인다. */
export function DueText({ due, late }: { due: string | null; late?: boolean }) {
  if (!due) return <em className="v3-due none">기한 없음</em>;
  return <span className={`v3-due${late ? " late" : ""}`}>{due}</span>;
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

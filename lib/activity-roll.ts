// 레일 「팀 활동」 — 연속된 같은 활동을 한 줄로 묶는다 (MD-P-2026-031 §C3 · 2-2-2).
//
// ── 왜 묶는가 ────────────────────────────────────────────────────
//
// 레일은 여섯 칸뿐이다. 한 사람이 같은 업무를 세 번 만지면 칸을 다 잡아먹는다.
// 가정이 아니라 **본 것**이다 — 지금 로컬 로그의 최근 여섯 줄 중 셋이
// 같은 사람 · 같은 업무 · 같은 종류의 진행률 변경이었다(1분 안에 세 번).
//
// **서버에서 묶는다.** 화면에서 묶으면 6건을 받아 3건만 그리게 된다 —
// 「LIMIT 은 정렬 뒤에 걸린다」와 같은 이야기다. 자를 것을 자른 **뒤**에 세어야 한다.
//
// ── 무엇을 같은 것으로 보는가 ────────────────────────────────────
//
//   같은 사람 · 같은 대상 · 같은 종류 · **1시간 안**
//
// 대상은 `task_id` 가 있으면 그것, 없으면 문구에서 따옴표 안의 이름을 쓴다.
// 종류는 문구의 **동사 부분**이다 — `진행률 변경` · `목표 수정` · `업무 상태 변경`.
// 셋 중 하나라도 다르면 다른 줄이다. 시간이 벌어져도 다른 줄이다 —
// **어제 한 일과 오늘 한 일은 같은 일이 아니다.**
import type { ActivityEntry } from "./types";

export interface RolledActivity {
  /** 대표 행의 id — 화면 key */
  id: number;
  userName: string | null;
  /** 묶인 줄의 **가장 최근** 시각. 묶었다고 옛 시각을 쓰지 않는다. */
  at: string;
  /** 사람 이름과 동사를 뺀 나머지 — 화면이 이름을 따로 그린다 */
  text: string;
  /** 묶인 개수. 1이면 화면에 안 적는다 — `1회` 는 정보가 아니다. */
  count: number;
  taskId: number | null;
}

/**
 * 레일에 올릴 활동의 **허용 목록** (§C3 회신 3).
 *
 * 판단 기준은 「무엇을 하고 있는가」가 아니라 **「내가 알아야 반응할 수 있는가」**다.
 * 로그인은 아무도 반응할 것이 없는데 로컬 로그의 **28%(268건 중 75건)** 를 차지했다.
 * 레일 여섯 칸이 "누가 로그인했다"로 찰 뻔했다.
 *
 * **금지 목록이 아니라 허용 목록이다.** 금지로 하면 새 종류가 조용히 섞여 들어온다 —
 * 로그인이 정확히 그렇게 들어와 있었다. 대신 허용 목록은 **새 종류를 조용히 빠뜨리므로**,
 * 어느 쪽에도 없는 동사를 `unclassifiedVerbs()` 로 뽑아 검사가 보고한다.
 * 안 보이면 없는 것이 되는 것은 여기서도 같다.
 */
const RAIL_VERBS = [
  // 업무 — 상태·진척·기한·담당
  "업무 생성", "업무 상태 변경", "업무 중단", "업무 완료", "업무 삭제",
  "진행률 변경", "담당 변경", "기한 변경", "차단 지정", "차단 해제", "막힘 해제",
  // 목표
  "목표 수정", "목표 생성", "팀 월 목표 생성", "연결 목표 변경",
  "목표 없음으로 지정", "목표 없음을 해제", "목표에 프로젝트 연결",
  "목표 연결을 프로젝트 상속으로 되돌림", "하위 업무가 되면서 목표 연결",
  // 결정
  "결정 확정", "결정 번복", "결정을 업무로 반영", "완료 사유",
  // 막힘 — 남이 막혀 있으면 내가 풀어줄 수 있다. 반응 대상이다.
  "막힘 표시", "업무 복구", "상태 변경",
  // 인수인계 — 받는 사람이 있다.
  "인수인계", "인수인계 문서 생성",
  // 에이전트 — 끝났으면 승인해야 한다. 반응 대상이다.
  "에이전트 완료", "에이전트 위임 시작",
  // 관리 작업 중 **유일한 예외** — 새 사람이 온 것은 팀이 알아야 한다(§C3 회신 3).
  // 비활성화는 넣지 않는다. 사람이 나간 것을 활동 로그로 알리는 것은 팀장이 할 말이다.
  "구성원 계정 발급",
];

/** 반응할 것이 없어 레일에서 빼는 것들 — 목록에 적어 두어야 「분류 안 됨」과 구별된다. */
const MUTED_VERBS = [
  "로그인", "로그아웃",
  "프로젝트 수정", "프로젝트 생성", "프로젝트 보관", "리소스 연결",
  "Notion 문서 생성", "Notion 문서 상위 페이지 지정",
  "성과 스냅샷 수동 저장", "데모 데이터 비우기 실행", "계정 비활성화", "계정 재활성화",
  "설정 변경", "권한 변경", "영역 수정",
];

/** 문구에서 동사만 남긴다 — 이름 · 따옴표 뒤 · 괄호를 뗀 앞부분. */
export function verbOf(message: string): string {
  return stripActor(message).replace(/\s*[—("“'].*$/, "").trim();
}

/**
 * 코멘트는 문구 형식이 다르다 — `권정혁 코멘트: 본문` (「이(가)」가 없다).
 * 허용 목록이 이걸 못 잡아 **댓글이 통째로 빠져 있었다.** 분류 안 된 동사 보고가 잡았다.
 * 형식이 다른 것은 형식으로 잡는다.
 */
const COMMENT_RE = /^(.+?)\s*코멘트:\s*(.+)$/;

/** 레일에 올릴 활동인가. 허용 목록에 **포함되는 문구**면 올린다. */
export function isRailActivity(message: string): boolean {
  if (COMMENT_RE.test(message)) return true;
  const v = verbOf(message);
  return RAIL_VERBS.some((k) => v.includes(k));
}

/**
 * 허용에도 침묵에도 없는 동사 — **새로 생긴 활동 종류**다.
 * 검사가 이걸 보고해서, 새 종류가 조용히 레일에서 빠지는 것을 막는다.
 */
export function unclassifiedVerbs(messages: string[]): string[] {
  const out = new Set<string>();
  for (const m of messages) {
    if (COMMENT_RE.test(m)) continue;
    const v = verbOf(m);
    if (!v) continue;
    if (RAIL_VERBS.some((k) => v.includes(k))) continue;
    if (MUTED_VERBS.some((k) => v.includes(k))) continue;
    out.add(v);
  }
  return Array.from(out);
}

/** 로그 문구에서 사람 이름을 뗀다 — `권정혁이(가) 진행률 변경 …` → `진행률 변경 …` */
function stripActor(message: string): string {
  return message.replace(/^.+?이\(가\)\s*/, "");
}

/**
 * 묶음 열쇠. **문구 전체를 쓰지 않는다** — `(0% → 90%)` 처럼 매번 바뀌는 값이 들어 있어
 * 전체로 비교하면 아무것도 안 묶인다. 동사와 대상만 남긴다.
 */
function groupKey(e: ActivityEntry): string {
  const body = stripActor(e.message);
  const verb = body.replace(/\s*\(.*?\)\s*/g, " ").split("—")[0].trim();   // 괄호 안 수치 제거
  const target = e.task_id ?? (/[""“”'](.+?)[""“”']/.exec(body)?.[1] ?? "");
  return `${e.user_id ?? "?"}|${verb}|${target}`;
}

const HOUR = 60 * 60 * 1000;

/**
 * 연속 묶기. **정렬된 입력**(최신 → 과거)을 받는다.
 * 이웃끼리만 본다 — 사이에 다른 활동이 끼면 그건 끊긴 것이다.
 * 「A A B A」 를 「A×3, B」 로 묶으면 시간 순서가 거짓이 된다.
 */
export function rollActivity(rows: ActivityEntry[], limit = 6): RolledActivity[] {
  const out: RolledActivity[] = [];
  let key: string | null = null;

  for (const e of rows) {
    const k = groupKey(e);
    const last = out[out.length - 1];
    const near = last && new Date(last.at).getTime() - new Date(e.created_at).getTime() < HOUR;
    if (last && k === key && near) {
      last.count += 1;
      /**
       * **묶이는 순간 괄호 안 수치를 뗀다.**
       * `진행률 변경 (80% → 35%)` 를 14건의 대표로 쓰면 나머지 13건에 대해 거짓말이 된다.
       * 한 건일 때만 그 값이 그 사건을 정확히 설명한다.
       */
      last.text = last.text.replace(/\s*\([^)]*\)/, "");
      continue;   // 시각은 그대로 둔다 — 첫 행이 가장 최근이다
    }
    if (out.length >= limit) break;
    out.push({
      id: e.id,
      userName: e.user_name ?? null,
      at: e.created_at,
      text: stripActor(e.message),
      count: 1,
      taskId: e.task_id ?? null,
    });
    key = k;
  }
  return out;
}

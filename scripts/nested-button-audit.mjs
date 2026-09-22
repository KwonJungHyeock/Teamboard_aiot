// `<button>` 안의 `<button>` 을 **소스에서** 찾는다 (MD-P-2026-062 §C).
//
// ── 왜 소스인가 ──────────────────────────────────────────────────
//
// 061 §D-15 에서 화면을 흔들어 찾았고 못 찾았다. 조용히 연 옛 화면 아홉에서
// 0개였고, block-walk·subtask-walk 이 **무언가를 만드는 도중**에만 떴다.
// 화면으로 찾으면 그 순간 그 상태에 있던 것만 잡힌다. 경고가 다섯 건이면
// 코드에 다섯 자리가 있다 — 자리는 소스에 가만히 있다.
//
// ── 두 가지 모양을 본다 ─────────────────────────────────────────
//
//   ㉮ **바로 겹침** — 같은 파일에서 `<button>` 안에 `<button>`
//   ㉯ **건너 겹침** — `<button>` 안에 다른 부품이 들어 있고, 그 부품의
//      뿌리가 `<button>` 이다. 파일 하나만 보면 안 보인다.
//
// ── 세지 않는 것 ────────────────────────────────────────────────
//
// 주석·문자열 안의 `<button>` 은 태그가 아니다. 먼저 걷어내고 센다.
// 걷어내지 않으면 이 파일의 설명 주석까지 결함으로 잡힌다.
//
// 읽기만 한다.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(26)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(26)} ${n}`); } };

const files = execFileSync("git", ["ls-files", "app", "components"], { encoding: "utf-8" })
  .split("\n").filter((f) => f.endsWith(".tsx"));

/** 주석과 글자열을 **자리를 지키며** 지운다 — 줄 번호가 안 어긋나게 공백으로. */
const blank = (s) => s.replace(/[^\n]/g, " ");
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)))
  .replace(/`(?:\\.|[^`\\])*`/g, blank)
  .replace(/"(?:\\.|[^"\\])*"/g, blank)
  .replace(/'(?:\\.|[^'\\])*'/g, blank);

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed",
  "source", "track", "wbr", "path", "circle", "rect", "line", "polyline", "polygon", "use", "stop"]);

/*
 * ── 태그 읽기 — 정규식으로 하면 틀린다 ─────────────────────────
 *
 * 처음엔 한 줄짜리 정규식으로 태그를 잡았고 **거짓 양성**이 나왔다.
 * 속성 안의 화살표(`onClick={() => …}`)에 들어 있는 `>` 를 태그 끝으로 읽어서,
 * 스스로 닫는 `<button … />` 이 「열리고 안 닫힌」 것으로 쌓였다. 그 뒤에 나온
 * 멀쩡한 버튼이 전부 「버튼 안의 버튼」이 됐다.
 *
 * 그래서 손으로 읽는다. 중괄호 깊이를 세면서, **깊이 0에서 만난 `>`** 만 태그
 * 끝으로 본다.
 *
 * 태그가 아닌 `<` 도 걸러야 한다.
 *   · `i < files.length` — JSX 는 `<` 뒤에 바로 이름이 온다. 빈칸이면 뺀다.
 *   · `useState<Foo>` — 제네릭. JSX 의 `<` 앞에는 글자가 오지 않는다
 *     (빈칸 · `(` · `{` · `>` · `,` · 줄바꿈 뿐). 앞 글자로 가른다.
 */
function* tags(src) {
  const before = /[A-Za-z0-9_$)\]]/;
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "<") continue;
    let j = i + 1;
    const close = src[j] === "/";
    /*
     * 제네릭(`useState<Foo>`)은 `<` 앞에 글자가 온다. **여는 태그에만** 적용한다 —
     * 닫는 태그는 글자 바로 뒤에 붙는 것이 보통이다(`⌘K</kbd>`). 처음엔 닫는
     * 태그까지 걸러서 `</kbd>` 를 놓쳤고, 그 바람에 스택이 어긋나 멀쩡한 버튼이
     * 「버튼 안의 버튼」으로 잡혔다.
     */
    if (!close && i > 0 && before.test(src[i - 1])) continue;
    if (close) j++;
    if (!/[A-Za-z]/.test(src[j] ?? "")) continue;            // `< b` 같은 비교
    let name = "";
    while (j < src.length && /[\w.]/.test(src[j])) name += src[j++];
    if (!/[\s/>]/.test(src[j] ?? "")) continue;              // 이름 뒤가 이상하면 태그가 아니다
    let brace = 0, end = -1;
    for (let k = j; k < src.length && k < j + 4000; k++) {
      const c = src[k];
      if (c === "{") brace++;
      else if (c === "}") brace--;
      else if (c === "<" && brace === 0) break;              // 닫는 `>` 없이 새 태그 — 태그가 아니었다
      else if (c === ">" && brace === 0) { end = k; break; }
    }
    if (end < 0) continue;
    const selfClose = src[end - 1] === "/";
    yield { close, name, selfClose, index: i };
    i = end;
  }
}

/* ── 부품의 뿌리가 button 인가 (㉯ 를 보려면 먼저 이것이 필요하다) ── */
const rootIsButton = new Map();      // 부품 이름 → 어느 파일에서
for (const f of files) {
  const src = strip(readFileSync(f, "utf-8"));
  // 선언 모양이 둘이다 — `function X(...)` 와 `const X = (...) =>`.
  // 하나만 보면 화살표로 쓴 부품을 통째로 놓친다.
  const decls = [
    ...src.matchAll(/(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)/g),
    ...src.matchAll(/(?:export\s+)?const\s+([A-Z]\w*)\s*(?::[^=]{0,120})?=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]{0,80})?=>/g),
  ];
  for (const m of decls) {
    const rest = src.slice(m.index, m.index + 4000);
    // 첫 번째로 **그리는** 태그. `return (` 도 `=> (` 도 받는다.
    const first = rest.match(/(?:return\s*\(?|=>\s*\(?)\s*<([A-Za-z][\w.]*)/);
    if (first && first[1] === "button") rootIsButton.set(m[1], f);
  }
}

/*
 * ── ㉰ 안쪽 어딘가에 button 이 있는 부품 ────────────────────────
 *
 * 뿌리만 보면 부족하다. `차단` 속성 줄의 콤보처럼 **부품 안 깊은 곳**에
 * 버튼이 있고, 그 부품이 `<button>` 안에 들어가는 모양이 있다. 뿌리가 div 라
 * 위 두 갈래에 안 걸린다.
 *
 * 부품 하나하나의 몸통을 가르지 않고 **파일 단위**로 본다 — 「이 파일이 버튼을
 * 그리는가」. 거칠어서 **아닌 것도 걸린다**(그 가지에서만 안 그릴 수 있다).
 * 그래서 이 갈래는 단언이 아니라 **읽어 볼 목록**이다.
 */
const fileHasButton = new Map();
for (const f of files) {
  const src = strip(readFileSync(f, "utf-8"));
  fileHasButton.set(f, [...tags(src)].some((t) => !t.close && t.name === "button"));
}
/** 파일 → { 들여온 이름 → 그 파일 } */
const importsOf = new Map();
for (const f of files) {
  const src = strip(readFileSync(f, "utf-8"));
  const map = new Map();
  for (const m of src.matchAll(/import\s+([\w{},\s*]+?)\s+from\s+["']([^"']+)["']/g)) {
    let target = m[2];
    if (target.startsWith("@/")) target = target.slice(2);
    else if (target.startsWith(".")) {
      const dir = f.split("/").slice(0, -1);
      for (const part of target.split("/")) {
        if (part === ".") continue;
        if (part === "..") dir.pop();
        else dir.push(part);
      }
      target = dir.join("/");
    } else continue;                                   // 패키지는 우리 파일이 아니다
    const hit = files.find((x) => x === `${target}.tsx` || x === `${target}/index.tsx`);
    if (!hit) continue;
    for (const nm of m[1].replace(/[{}]/g, " ").split(/[\s,]+/).filter(Boolean))
      if (/^[A-Z]/.test(nm)) map.set(nm, hit);
  }
  importsOf.set(f, map);
}

/* ── 겹치는 자리를 센다 ─────────────────────────────────────── */
const direct = [], indirect = [], maybe = [];
for (const f of files) {
  const src = strip(readFileSync(f, "utf-8"));
  const imports = importsOf.get(f) ?? new Map();
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  const stack = [];
  let depth = 0;                       // 지금 몇 겹의 button 안인가
  for (const m of tags(src)) {
    const { close, name, selfClose } = m;
    if (close) { const top = stack.pop(); if (top === "button") depth--; continue; }
    const isVoid = selfClose || VOID.has(name);
    if (name === "button") {
      if (depth > 0) direct.push(`${f}:${lineOf(m.index)}`);
      if (!isVoid) { stack.push("button"); depth++; }
      continue;
    }
    /*
     * 뿌리가 button 인 부품은 **button 으로 친다.** 그래야 두 방향이 다 잡힌다 —
     * `<button><Chip/></button>` 뿐 아니라 `<Chip><button/></Chip>` 도.
     * 한쪽만 보면 자식으로 넘긴 버튼을 놓친다.
     */
    if (rootIsButton.has(name)) {
      if (depth > 0)
        indirect.push(`${f}:${lineOf(m.index)} (<${name}> 의 뿌리가 button — ${rootIsButton.get(name)})`);
      if (!isVoid) { stack.push("button"); depth++; }
      else stack.push(name);
      if (isVoid) stack.pop();
      continue;
    }
    if (depth > 0 && /^[A-Z]/.test(name)) {
      const src2 = imports.get(name);
      if (src2 && fileHasButton.get(src2))
        maybe.push(`${f}:${lineOf(m.index)} <${name}> — ${src2} 가 어딘가에서 button 을 그린다`);
    }
    if (!isVoid) stack.push(name);
  }
}

console.log(`훑은 파일 ${files.length}개 · 뿌리가 button 인 부품 ${rootIsButton.size}개` +
            ` [${[...rootIsButton.keys()].join(" · ") || "없음"}]`);
console.log(`\n── ㉮ 바로 겹침 ${direct.length}자리 ──`);
for (const d of direct) console.log(`  ${d}`);
console.log(`\n── ㉯ 건너 겹침 ${indirect.length}자리 ──`);
for (const d of indirect) console.log(`  ${d}`);
console.log(`\n── ㉰ 읽어 볼 자리 ${maybe.length}곳 (button 안의 부품이 제 안에서 button 을 그린다) ──`);
for (const d of maybe) console.log(`  ${d}`);

/*
 * ── ㉱ 프롭으로 건너가는 겹침 (062 §C 가 찾은 그 모양) ──────────
 *
 * 위 셋으로는 **0자리**가 나왔는데 화면에서는 경고가 났다. 리액트가 찍어 준
 * 부품 스택이 `button > span > button … at PropertyBlock` 이었고, 소스를
 * 읽어 보니 겹침이 **JSX 나무 안이 아니라 프롭을 건너서** 생기고 있었다.
 *
 *   PropertyBlock 은 `r.editor` 가 있는 줄의 값을 `<button className="prop-v">`
 *   로 감싼다(눌러서 편집기를 여는 자리라서). 그 `r.value` 는 **부르는 쪽이
 *   건네준 노드**다. 건네준 노드 안에 `<button>` 이 있으면 그때 겹친다.
 *
 * 그래서 조건은 하나로 적힌다 —
 *   **`editor` 가 있고 `value` 안에 `<button>` 이 있는 줄.**
 *   `editor` 가 없으면 PropertyBlock 이 `<span className="prop-v ro">` 로
 *   감싸므로 같은 값이어도 겹치지 않는다(「이 업무가 막는 업무」 줄이 그 증거다).
 *
 * 프롭을 따라가는 일반 검사는 안 만들었다. 이 자리 하나를 위해 타입을 풀어
 * 따라가는 기계를 만드는 것은 과하다 — **이 모양**을 이름으로 적어 둔다.
 */
/*
 * 주석만 걷어낸다(글자열은 남긴다 — `key: "parent"` 를 읽어야 한다).
 * 이게 없어서 한 번 속았다: `valueActs` 를 **주석 처리**해 놓고 깨뜨리기를
 * 해 봤는데 검사가 여전히 초록이었다. 주석 안의 글자를 약속으로 읽은 것이다.
 * 062 에서 주석 속 `tabs={isLead ?` 를 치환하고 JSX 는 그대로 둔 것과 같은 자리다.
 */
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, " "));

const propRows = [];
for (const f of files) {
  const src = stripComments(readFileSync(f, "utf-8"));
  if (!/<PropertyBlock/.test(src)) continue;
  const marks = [...src.matchAll(/\bkey:\s*"([\w]+)"/g)];
  marks.forEach((m, i) => {
    const chunk = src.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : src.length);
    const ed = chunk.search(/\beditor:/);
    if (ed < 0) return;                                   // 편집기가 없으면 span 으로 감싼다
    if (/\beditor:\s*undefined\b/.test(chunk)) return;    // 아예 안 주는 줄
    const valuePart = chunk.slice(0, ed);
    if (!/<button/.test(valuePart)) return;
    /*
     * 064 §A — **부르는 쪽이 「이 값은 스스로 눌린다」고 말했으면 겹치지 않는다.**
     * PropertyBlock 이 그런 줄은 `<button>` 으로 감싸지 않고 값과 편집 버튼을
     * 형제로 둔다. 이 줄이 없으면 고친 자리가 영원히 빨갛고, 그러면 검사기가
     * 무엇을 재는지 아무도 안 믿게 된다.
     * 프롭 이름을 여기 적어 두는 것은 **부르는 쪽의 약속을 읽는 것**이지
     * 값의 속을 들여다보는 것이 아니다(§G 063).
     */
    if (/\bvalueActs:\s*true\b/.test(chunk)) return;
    propRows.push(`${f}:${src.slice(0, m.index).split("\n").length} 「${
      chunk.match(/label:\s*"([^"]*)"/)?.[1] ?? m[1]}」 — value 안에 <button> · editor 있음`);
  });
}
console.log(`\n── ㉱ 프롭으로 건너가는 겹침 ${propRows.length}자리 ──`);
for (const d of propRows) console.log(`  ${d}`);

/*
 * ── 존재 단언 ────────────────────────────────────────────────
 * 태그를 하나도 못 읽었으면 「0자리」는 「깨끗하다」가 아니라 **못 읽은 것**이다.
 */
let seen = 0, btns = 0;
for (const f of files) {
  const src = strip(readFileSync(f, "utf-8"));
  for (const m of tags(src)) { seen++; if (m.name === "button") btns++; }
}
chk("①-태그를-읽었다", seen > 3000 && btns > 100, `태그 ${seen}개 · 그중 button ${btns}개`);
chk("②-JSX-안에서-겹친-자리", direct.length + indirect.length === 0,
    direct.length + indirect.length === 0 ? "0자리"
      : `㉮ ${direct.length} · ㉯ ${indirect.length} — [${[...direct, ...indirect].join(" · ")}]`);
/*
 * ③ 은 **지금 빨갛다.** 062 §C-10 이 「조건만 적어서 보고하고 고치지 말라」고
 * 했다 — 옛 화면이라 손대는 범위를 지시자가 정한다. 빨간 채로 두는 것이
 * 이번 회차의 결과다(§G 061 · 물릴 때와 고칠 때는 다른 회차다).
 */
chk("③-프롭으로-건너가는-겹침", propRows.length === 0,
    propRows.length === 0 ? "0자리" : `${propRows.length}자리 — [${propRows.join(" · ")}]`);

console.log(`\n${pass}/${pass + fail} 통과`);
process.exitCode = fail === 0 ? 0 : 1;

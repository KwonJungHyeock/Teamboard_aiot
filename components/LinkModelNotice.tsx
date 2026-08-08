"use client";

// 연결 모델이 바뀌었다는 1회 안내 (MD-P-2026-030 §C3).
//
// 왜 필요한가. 어제까지 프로젝트를 목표에 붙여 두면 진척이 잡혔다. 오늘부터는 안 잡힌다.
// 아무 말 없이 숫자만 내려가면 사람들은 **고장으로 읽는다.**
// 데이터를 지운 것이 아니라 세는 방법이 바뀐 것이고, 그 사실을 한 번은 말해야 한다.
//
// 규칙 세 가지.
//   ① 한 번만 뜬다. 닫으면 다시 뜨지 않는다.
//   ② 코랄을 쓰지 않는다. 사고가 아니라 안내다 (지시 22 와 같은 톤 규칙).
//   ③ 다음 행동이 한 줄 있다. "바뀌었습니다"로 끝나면 읽는 사람이 할 일이 없다.
//
// 숫자(21건 · 1건)는 프로덕션 연간 목표 #8 의 실측값이다. 화면에서 계산하지 않는다 —
// 이 안내는 "이번 배포로 무엇이 달라졌는가"를 말하는 것이지 지금 상태를 재는 것이 아니다.
// 이미 바뀐 뒤에 계산하면 "빠졌다"는 과거를 영영 말할 수 없다.
import { useEffect, useState } from "react";

/** 값이 바뀌면 안내가 한 번 더 뜬다. 같은 내용을 다시 띄우고 싶지 않으면 건드리지 말 것. */
const KEY = "tb:notice:link-model-030";

export default function LinkModelNotice() {
  // 서버 렌더에서는 localStorage 를 못 읽는다. 처음엔 감춰 두고 마운트 뒤에 정한다 —
  // 반대로 하면 이미 닫은 사람 화면에서 한 프레임 깜빡인다.
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(localStorage.getItem(KEY) !== "1"); } catch { setShow(false); }
  }, []);

  if (!show) return null;
  const close = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* 저장 못 해도 닫히기는 한다 */ }
    setShow(false);
  };

  return (
    <aside className="lmn" role="status" aria-label="연결 방식 변경 안내">
      <div className="lmn-b">
        <p className="lmn-t">프로젝트를 목표에 연결하는 방식이 없어졌습니다.</p>
        <p className="lmn-d">
          연간 목표가 세던 업무 21건이 빠지고, 월 목표에 직접 연결된 1건만 남습니다.
        </p>
        <p className="lmn-d">
          업무를 월 목표에 연결해 주세요 — 미연결 업무에서 한 번에 붙일 수 있어요.
        </p>
      </div>
      <button className="lmn-x" onClick={close} aria-label="안내 닫기" title="닫기 — 다시 뜨지 않습니다">✕</button>
    </aside>
  );
}

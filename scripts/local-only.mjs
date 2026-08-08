// 로컬 잠금 (MD-P-2026-027 지시 32).
//
// **로컬 전용. 원격 DB 에서 실행 금지.**
//
// 쓰기 동작이 있는 검증 스크립트는 전부 첫 줄에서 이것을 부른다.
// §D3 검사가 진짜 업무 2건의 프로젝트를 실제로 바꿨던 일이 있었다. 그때는 로컬이라
// 되돌렸지만, 같은 스크립트가 프로덕션 DSN 을 물고 돌았다면 되돌릴 방법이 없다.
// 스크립트가 자기가 만든 행만 만지게 고치는 것은 사고 범위를 줄이는 일이고,
// 이 잠금은 사고 자체를 막는 일이다. 둘 다 필요하다.
//
// **우회 플래그를 만들지 않는다.** 우회로가 있으면 급할 때 반드시 쓰이고,
// 급할 때가 정확히 실수하는 때다.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * DATABASE_URL 이 로컬이 아니면 즉시 종료한다.
 * @param {string} scriptName 오류 메시지에 찍을 이름
 */
export function requireLocalDb(scriptName) {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) {
    console.error(`${scriptName}: DATABASE_URL 이 없습니다.`);
    process.exit(1);
  }
  let host;
  try {
    host = new URL(dsn).hostname;
  } catch {
    console.error(`${scriptName}: DATABASE_URL 을 해석할 수 없습니다.`);
    process.exit(1);
  }
  if (!LOCAL_HOSTS.has(host)) {
    // 접속 문자열 전체는 찍지 않는다 — 비밀번호가 들어 있다. 호스트만 보인다.
    console.error(
      `${scriptName}: 로컬 전용 스크립트입니다. DATABASE_URL 의 호스트가 "${host}" 입니다.\n` +
      `이 스크립트는 데이터를 만들고 지웁니다. 원격 DB 에서는 실행하지 않습니다.`
    );
    process.exit(1);
  }
}

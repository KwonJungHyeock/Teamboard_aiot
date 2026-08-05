// e2e 스모크 설정 (MD-P-2026-015 §D · MD-P-008 D-4)
// 프로덕션 빌드를 띄워서 돈다 — dev 서버에서만 통과하는 실패를 놓치지 않기 위해서다.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3410);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,      // 로그인 상태를 공유하므로 순차 실행
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // 브라우저가 미리 깔린 환경(개발 컨테이너 등)에서 재다운로드를 피하려면
    // E2E_CHROMIUM 에 실행 파일 경로를 준다. CI 는 playwright install 로 받으므로 비워둔다.
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // 자동 마이그레이션(파트 X) — lib/db 가 최초 DB 접근 시 db/migrations/*.sql 를 fs로 읽어
    // 적용한다. import가 아니라 런타임 fs 로 읽히므로 모든 서버 함수 번들에 포함시킨다
    // (lib/db 는 사실상 모든 서버 라우트/서버 컴포넌트가 사용).
    outputFileTracingIncludes: {
      "/**": ["./db/migrations/**"],
      // 데모 시드 주입 라우트는 자식 프로세스로 스크립트를 실행 → 스크립트·pg 포함
      "/api/admin/seed-demo": ["./scripts/**", "./db/**", "./node_modules/pg/**"],
      "/api/admin/seed-demo/route": ["./scripts/**", "./db/**", "./node_modules/pg/**"],
    },
  },
};

export default nextConfig;

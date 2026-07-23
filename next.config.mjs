/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // TEMPORARY — /api/admin/init-db 삭제 시 함께 제거.
    // 임시 초기화 라우트가 자식 프로세스로 실행하는 스크립트·스키마를 번들에 포함.
    outputFileTracingIncludes: {
      "/api/admin/init-db": ["./scripts/**", "./db/**", "./node_modules/pg/**"],
      "/api/admin/init-db/route": ["./scripts/**", "./db/**", "./node_modules/pg/**"],
    },
  },
};

export default nextConfig;

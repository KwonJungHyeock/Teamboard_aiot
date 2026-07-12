# 팀보드 (TeamBoard)

R&D팀 3명이 각자 AI 부사수를 두고, 팀 업무를 Notion과 연동해 관리하는 사내 도구.

핵심 컨셉: **부사수(Claude) 초안 → 사수(담당자) 승인 → Notion 팀 업무 타임라인 기록**.
초안·중간상태는 자체 DB에만 저장하고, 승인된 확정본만 Notion에 씁니다.

## 화면

| 경로 | 화면 | 접근 |
|------|------|------|
| `/assistant` | 화면 A — 내 부사수 (위임 / 진행 중 / 보고 대기·승인 게이트 / 활동 로그 / 부사수 설정) | 전원 |
| `/timeline` | 화면 B — 팀 타임라인 (Notion 읽기, 필터) | 전원 |
| `/control` | 화면 C — 관제뷰 (실시간 현황 / 막힌 곳 / 진행률 / 마감 임박 + 승인 처리) | 팀장 |
| `/settings` | Notion 연동 범위 (다중 DB 선택은 2차, UI만 비활성 배치) | 팀장 |

## 기술 스택

- Next.js (App Router) + TypeScript — Vercel 배포
- Postgres (`lib/db.ts`로 추상화 — 다른 DB로 교체 시 이 파일만 수정)
- Claude API (`@anthropic-ai/sdk`, 모델: `claude-opus-4-8`) — 부사수 초안 생성
- Notion API (버전 `2025-09-03`, data source 기반) — 서버 API Routes에서만 호출

## 설정

1. 의존성 설치

   ```bash
   npm install
   ```

2. 환경변수 — `.env.example`을 `.env.local`로 복사 후 채우기

   | 변수 | 설명 |
   |------|------|
   | `ANTHROPIC_API_KEY` | Claude API 키 (서버 전용) |
   | `NOTION_TOKEN` | "팀 업무 타임라인" DB에만 연결된 Notion 통합 토큰 |
   | `NOTION_TIMELINE_DS_ID` | 타임라인 data_source_id (기본값 내장) |
   | `DATABASE_URL` | Postgres 연결 문자열 |
   | `AUTH_SECRET` | 세션 서명용 랜덤 문자열 (`openssl rand -hex 32`) |
   | `SEED_DEFAULT_PASSWORD` | 시드 시 팀원 초기 비밀번호 |

3. DB 초기화 + 팀원 시드 (권정혁/박주희/조서연 + 부사수 + Notion person ID)

   ```bash
   npm run db:init
   ```

4. 실행

   ```bash
   npm run dev
   ```

## 인증에 대해

메일플러그 SSO/OAuth 방식이 확정되지 않아(PRD 16장), 1차는 **업무메일 + 비밀번호** 로그인으로
구현했습니다. `lib/auth.ts`의 `authenticate()`만 교체하면 메일플러그 연동으로 전환할 수 있습니다.
시드된 계정의 이메일은 `scripts/init-db.mjs`의 `TEAM` 배열에서 실제 업무메일로 수정하세요.

## 보안 원칙 (PRD 11장)

- Notion 토큰·Claude 키는 서버 환경변수에만 존재, 클라이언트 노출 없음
- Notion 접근은 지정된 data source 1개로 한정, 연동 범위 변경은 `role=lead`만
- 승인 게이트 우회 불가 — Notion 쓰기는 `/api/drafts/[id]/approve` 한 곳뿐
- Notion 페이지 삭제 API 미사용 (완료는 상태 변경으로)
- 모든 위임/승인/반려/설정 변경은 `activity_log`에 기록 (감사 추적)

## API

```
POST /api/auth/login             로그인 (세션 쿠키 발급)
POST /api/auth/logout            로그아웃
GET  /api/auth/me                현재 사용자
POST /api/assistant/draft        부사수 위임 → Claude 초안 생성 (reworkOf로 재작업)
GET/PUT /api/assistant/settings  부사수 커스텀
GET  /api/drafts?status=&scope=  초안 목록 (scope=all은 팀장)
POST /api/drafts/[id]/approve    승인 → Notion 기록
POST /api/drafts/[id]/reject     반려 (feedback)
GET  /api/notion/timeline        팀 타임라인 조회
GET  /api/control/overview       관제뷰 요약 (팀장)
GET  /api/activity               활동 로그
GET/PUT /api/settings/notion-scope  연동 범위 (PUT은 팀장)
```

# 팀보드 (TeamBoard) — 개발 내용 요약

> AIoT 교육플랫폼 사업팀(ROBODYNE SYSTEMS) 사내 업무 관리 도구
> 작성일: 2026-07-23 · 배포: https://teamboard-aiot.vercel.app

---

## 1. 한 줄 요약

각 팀원이 자기 **AI 부사수**에게 부수 업무(자료조사·회의록·내용정리·반복업무)를 맡기면,
부사수가 **초안**을 작성하고, **사수(담당자)의 승인**을 거친 확정본만
**팀 Notion "팀 업무 타임라인" DB에 기록**되는 도구.

핵심 원칙: **초안·중간상태는 자체 DB에만, 승인된 확정본만 Notion에.** (승인 게이트)

## 2. 개발 범위 — 1차(MVP) 전체 완료

| 항목 | 상태 |
|------|------|
| 팀 Notion 타임라인 전체 리스트 조회 (화면 B) | ✅ 구현 완료 (토큰 등록 대기) |
| 부사수 초안 생성 (4개 업무 유형) | ✅ (LLM 키 등록 전까지 데모 모드) |
| 승인 게이트: 승인/반려·재작업 → 승인 시 Notion 기록 | ✅ |
| 화면 3종: 내 부사수 / 팀 타임라인 / 관제뷰 | ✅ (+ 연동 설정 화면) |
| 부사수 커스텀: 이름·보고 스타일·업무 영역·조회 범위·커스텀 지침 | ✅ |
| 실시간 활동 로그 (감사 추적) | ✅ |
| 권한: Notion 연동 범위 수정은 팀장만 | ✅ |
| (2차) 팀장 → 팀원 업무 지시 / 다중 DB 선택 | 자리만 배치 (비활성) |

## 3. 화면 구성

| 경로 | 화면 | 접근 | 내용 |
|------|------|------|------|
| `/login` | 로그인 | - | 업무메일 + 비밀번호 |
| `/assistant` | **화면 A — 내 부사수** | 전원 | 부사수 헤더(상태: 작동중/대기/보고대기), 부수 업무 맡기기, 진행 중 업무, 보고 대기(승인 게이트: 승인/반려·재작업), 반려→재작업 지시, 실시간 활동 로그(8초 폴링), 부사수 설정 |
| `/timeline` | **화면 B — 팀 타임라인** | 전원 | Notion DB 전체 리스트(읽기 전용), 상태/담당자/업무구분 필터 |
| `/control` | **화면 C — 관제뷰** | 팀장 | 4요소: ①실시간 현황(팀원·부사수별) ②막힌 곳(승인 대기+지연 업무) ③프로젝트별 진행률 ④마감 임박(이번 주). 팀원 초안 승인/반려 처리 가능. 업무 지시 버튼은 2차용 비활성 |
| `/settings` | 연동 설정 | 팀장 | Notion 연동 범위(data_source_id) 수정, 다중 DB 선택은 비활성 placeholder |

## 4. 기술 스택 · 아키텍처

```
[브라우저] Next.js 14 (App Router) — 다크 테마 + 에듀이노 레드(#E31E24), Pretendard/JetBrains Mono
    │  세션 쿠키 (HMAC 서명)
    ▼
[Vercel 서버] API Routes  ← 모든 비밀키는 서버 환경변수에만
    ├──▶ LLM API   (lib/llm.ts — OpenAI gpt-5.1 / Claude 자동 선택, 키 없으면 데모 모드)
    ├──▶ Notion API (lib/notion.ts — 버전 2025-09-03, data source 기반, 서버에서만 호출)
    └──▶ Postgres   (lib/db.ts — Neon, 부사수 설정·초안·승인·로그)
```

- **프론트/백**: Next.js 14.2 (App Router) + TypeScript
- **DB**: Neon Postgres (Vercel Storage 연동) — `lib/db.ts`로 추상화되어 교체 용이
- **LLM**: `lib/llm.ts` 공급자 추상화 레이어
  - `OPENAI_API_KEY` 설정 → OpenAI (`gpt-5.1`, `OPENAI_MODEL`로 변경 가능)
  - `ANTHROPIC_API_KEY` 설정 → Claude (`claude-opus-4-8`)
  - 둘 다 없으면 → **데모 모드** (자리표시 초안 생성, 흐름 검증용)
- **Notion**: 공식 REST API 직접 호출, `data_source_id` 기반 조회/생성
- **배포**: Vercel (회사 Pro 팀 `eduino-lab's projects`), Production 브랜치 = `main`

## 5. 데이터 모델 (Postgres)

```
users         id, email, name, role(lead|member), notion_user_id, password_hash
assistants    id, user_id(1:1), name, report_style(brief|detailed),
              work_areas(JSONB), auto_scope, system_prompt_extra
drafts        id, assistant_id, user_id, task_type, instruction, title, body,
              status(working|pending|approved|rejected|failed),
              feedback, rework_of, approver_id, notion_page_id, decided_at
activity_log  id, user_id, assistant_id, message, level, created_at
app_settings  key, value(JSONB), updated_by  — notion_scope 등
```

- 시드(`npm run db:init`): 권정혁(lead)·박주희·조서연(member) 3인 + 부사수 + PRD의 Notion person ID 매핑. 여러 번 실행해도 안전.

## 6. 승인 게이트 흐름 (핵심)

```
1. 팀원이 부사수에게 위임 → drafts(status=working) 저장 + 활동 로그
2. LLM이 초안 생성 → status=pending → 화면 A "보고 대기" 표시
   (실패 시 status=failed + 오류 로그)
3. 사수(본인) 또는 팀장이 [승인] → 승인 모달에서 Notion 속성 선택
   (구분/업무유형/업무 구분/상태/우선순위/기간 — PRD 허용값만 선택 가능)
4. 서버가 Notion 타임라인 DB에 페이지 생성 (담당자 person 자동 매핑,
   초안 본문은 마크다운→Notion 블록 변환해 페이지 본문으로)
5. 성공 시에만 status=approved + notion_page_id 저장 + 로그
   (Notion 기록 실패 시 초안은 pending 유지 — 유실 없음)
6. [반려] 시 status=rejected + 반려 사유 저장 → "재작업 지시" 버튼으로
   이전 초안+반려 사유를 반영한 재생성
```

**Notion 쓰기 코드는 승인 라우트 단 한 곳** — 승인 게이트 우회 불가.

## 7. API 엔드포인트

```
POST /api/auth/login              로그인 (HMAC 서명 세션 쿠키 발급, 7일)
POST /api/auth/logout             로그아웃
GET  /api/auth/me                 현재 사용자
POST /api/assistant/draft         위임 → LLM 초안 생성 (reworkOf로 재작업)
GET/PUT /api/assistant/settings   부사수 커스텀 (본인 것만)
GET  /api/drafts?status=&scope=   초안 목록 (scope=all은 팀장 전용)
POST /api/drafts/[id]/approve     승인 → Notion 기록 (본인 또는 팀장)
POST /api/drafts/[id]/reject      반려 + 피드백 (본인 또는 팀장)
GET  /api/notion/timeline         팀 타임라인 조회
GET  /api/control/overview        관제뷰 요약 (팀장 전용)
GET  /api/activity                활동 로그 (scope=all은 팀장)
GET/PUT /api/settings/notion-scope 연동 범위 (PUT은 팀장 전용)
```

## 8. 보안 · 권한 (PRD 11장 준수)

1. Notion 토큰·LLM 키는 서버 환경변수에만 — 클라이언트 노출 없음
2. Notion 접근은 연동된 data source 1개로 한정, 범위 변경 UI는 `role=lead`만
3. 승인 게이트 우회 불가 (Notion 쓰기 단일 경로)
4. Notion 페이지 삭제 API 미사용
5. 모든 로그인/위임/승인/반려/설정 변경은 activity_log 기록
6. 비밀번호는 scrypt 해시 저장, 세션은 HMAC-SHA256 서명 쿠키(httpOnly)
7. 미들웨어 + 서버측 세션 검증 이중 가드, 팀원의 팀장 전용 API 접근 시 403

## 9. 인증에 대한 결정

메일플러그 SSO/OAuth 방식이 미확정(PRD 16장 열린 질문)이라 1차는
**업무메일 + 비밀번호** 방식으로 구현. 확정되면 `lib/auth.ts`의 `authenticate()`
함수만 교체하면 전환 가능. 초기 비밀번호는 시드 시 지정(기본 `teamboard123!`),
시드 이메일은 `scripts/init-db.mjs`의 `TEAM` 배열에서 수정.

## 10. 배포 이력 · 트러블슈팅 기록

| 문제 | 원인 | 해결 |
|------|------|------|
| Vercel 빌드 실패 (초기) | Hobby 플랜 함수 시간 제한(60초) 초과 — `maxDuration=120` | 60초로 조정 |
| "No Output Directory named 'public'" 빌드 실패 | 저장소가 비어 있을 때 프로젝트를 만들어 Framework가 "Other"로 인식 | `vercel.json`에 `"framework": "nextjs"` 명시 |
| Anthropic API 결제 불가 | 결제 수단 문제 | LLM 공급자 추상화(`lib/llm.ts`)로 OpenAI 전환 지원 + 키 없이 도는 데모 모드 추가 |
| Notion 통합 생성 불가 | 계정이 회사 워크스페이스에서 멤버 등급 (소유자 권한 필요) | 대표님께 권한 요청 예정 |

현재 상태: **회사 Vercel Pro 팀에서 배포 완료, Neon DB 연결·시드 완료, 로그인·데모 흐름 검증 완료.**

## 11. 남은 작업 (운영 전환 체크리스트)

- [ ] Notion 통합 토큰 발급 (워크스페이스 소유자 권한 필요 — 요청 중)
      → Vercel에 `NOTION_TOKEN` 등록 → Redeploy → 타임라인/승인 기록 확인
- [ ] OpenAI 법인 결제 → API 키 발급 (요청 중)
      → Vercel에 `OPENAI_API_KEY` 등록 → Redeploy → 실제 AI 초안 전환
- [ ] 시드 이메일을 실제 업무메일로 교체 (`scripts/init-db.mjs` 수정 후 재시드)
- [ ] 팀원 초기 비밀번호 변경 안내 (비밀번호 변경 UI는 추후 추가 가능)
- [ ] (2차) 팀장→팀원 업무 지시, 다중 DB 연동, 부사수 간 조율, 자료조사 웹 검색 연동

## 12. 환경변수 정리

| 변수 | 필수 | 설명 |
|------|:---:|------|
| `DATABASE_URL` | ✅ | Neon Postgres 연결 문자열 (Vercel Storage 연동으로 자동 설정) |
| `AUTH_SECRET` | ✅ | 세션 서명 키 (랜덤 64자) |
| `NOTION_TOKEN` | 🔜 | Notion 내부 통합 시크릿 — 타임라인 조회/기록에 필요 |
| `OPENAI_API_KEY` | 🔜 | 실제 AI 초안 생성에 필요 (없으면 데모 모드) |
| `OPENAI_MODEL` | - | 기본 `gpt-5.1`, 비용 절감 시 `gpt-5-mini` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | - | Claude 사용 시 (결제 해결되면 전환 가능) |
| `LLM_PROVIDER` | - | 키가 둘 다 있을 때 강제 선택: `openai` \| `anthropic` |
| `NOTION_TIMELINE_DS_ID` | - | 타임라인 data_source_id (코드 기본값 내장) |

## 13. 저장소 구조

```
app/                 페이지(App Router) + API Routes
  api/…              12개 엔드포인트 (7장 참조)
  assistant|timeline|control|settings|login/
components/          Nav, AssistantView, TimelineView, ControlView,
                     ApproveModal(승인 게이트 모달), NotionScopeSettings
lib/                 db.ts(DB 추상화) auth.ts(세션/인증) llm.ts(LLM 추상화)
                     notion.ts(Notion API) activity.ts(로그) types.ts api.ts
db/schema.sql        스키마
scripts/init-db.mjs  스키마 적용 + 팀원 시드
middleware.ts        페이지 접근 가드
vercel.json          프레임워크 명시 (빌드 실패 방지)
```

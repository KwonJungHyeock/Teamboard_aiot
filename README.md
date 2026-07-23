# 팀보드 (TeamBoard)

AIoT 교육플랫폼 사업팀(ROBODYNE SYSTEMS)의 메인 업무 관리 도구. 팀원마다 AI 부사수를 두고,
목표·업무·시그널·월간 보고를 자체 DB에서 관리하며 확정본만 Notion에 미러합니다.

핵심 컨셉: **부사수(LLM) 초안 → 사수(담당자) 승인 → Notion 팀 업무 타임라인 기록**.
초안·중간상태는 자체 DB에만 저장하고, 승인된 확정본만 Notion에 씁니다.

> 📄 **기준 문서**: [`docs/SPEC.md`](docs/SPEC.md) (v1.1) 가 유일한 기준이며, Phase 지침은
> [`docs/CHANGE-GUIDE.md`](docs/CHANGE-GUIDE.md), 디자인 참조는 `docs/prototype/index.html` 입니다.
> 초기 3화면 구조 문서는 `docs/archive/` 로 보관되었습니다.

## 화면

| 경로 | 화면 | 접근 |
|------|------|------|
| `/` | 홈 대시보드 — 지표 4종·팀 타임라인(2층 레인)·이번 달 목표·마감 임박·시그널·허들 | 전원 |
| `/calendar` | 캘린더 (일·주·월 2층 레인) | 전원 |
| `/tasks` | 업무 목록 (인박스·필터·상세·목표 연결) | 전원 |
| `/goals` | 목표 트리 (연간·분기·월, 보관함) | 전원 |
| `/projects` | 전체 프로젝트 인덱스 (카드 그리드) | 전원 |
| `/projects/[id]` | 프로젝트 상세 (개요·목표·업무·자료) | 전원 |
| `/signals` | 시그널 (결정·확인·메모·리스크, 생명주기) | 전원 |
| `/huddle` | 허들 (메모→결정 흐름) | 전원 |
| `/reports` | 월간 보고 (집계·문장화·승인·PDF) | 팀장 |
| `/members` | 구성원·계정 발급 | 팀장 |
| `/assistant` | 내 부사수 (위임·승인 게이트·설정) | 전원 |
| `/settings` | Notion 연동 범위 설정 | 팀장 |
| `/timeline` | Notion 타임라인 (보조, 읽기) | 전원 |

## 기술 스택

- Next.js 14 (App Router) + TypeScript — Vercel 배포
- Postgres (`lib/db.ts`로 추상화) — Neon(Vercel Storage) 사용
- LLM (`lib/llm.ts`) — 부사수 초안·보고 문장화. OpenAI(`gpt-5.1`) 또는 Claude(`claude-opus-4-8`)
  중 설정된 키에 따라 자동 선택, 키가 없으면 데모(mock) 모드
- Notion API — 서버 API Routes에서만 호출, 승인 게이트 단일 경로로만 쓰기

## 실행

```bash
npm install
cp .env.example .env.local   # 환경변수 채우기
npm run db:init              # 스키마 + 운영 시드 (팀원 3인 + 부사수 + 프로젝트 + config)
npm run db:seed-demo         # (선택) 데모 데이터 — 화면 검수용
npm run dev                  # 개발 서버
```

프로덕션 빌드: `npm run build && npm start`.

## 환경변수

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | Postgres 연결 문자열 (Vercel Neon 통합 시 자동 주입) |
| `AUTH_SECRET` | 세션 서명용 랜덤 문자열 (`openssl rand -hex 32`) |
| `OPENAI_API_KEY` **또는** `ANTHROPIC_API_KEY` | 부사수 LLM 키 (서버 전용). 없으면 데모 모드 |
| `LLM_PROVIDER` | (선택) 강제 선택: `openai` \| `anthropic` \| `mock` |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` | (선택) 모델 오버라이드. 기본 `gpt-5.1` / `claude-opus-4-8` |
| `NOTION_TOKEN` | "팀 업무 타임라인" DB에 연결된 Notion 통합 토큰 (승인 기록용) |
| `NOTION_TIMELINE_DS_ID` | 타임라인 data_source_id (기본값 내장) |
| `SEED_DEFAULT_PASSWORD` | 시드 시 팀원 초기 비밀번호 (기본 `teamboard123!`) |

## 도메인 요약

- **Actor 모델**: 사람과 부사수를 `actor` 하나로 통합(`type` 구분). 에이전트는 제안만, 확정은 사람.
- **목표**: 연간 → 분기 → 월. 월 목표에만 Task 연결, 상위는 집계. 진척 = `done/(연결−dropped)`.
- **시그널**: decision/review/memo/risk. 생명주기 open → discussing → decided → resolved/archived.
  허들은 `signal.huddle_at`로 조회(scope는 가시성 전용).
- **월간 보고**: `lib/report.ts`가 DB에서 집계(수치 확정), LLM은 문장화만. 기존 승인 게이트 재사용.
- **권한**: 일반 업무·시그널은 member 전권, 단 proposed 승인·decision 종결은 담당자/lead로 제한.

## 보안 원칙

- Notion 토큰·LLM 키는 서버 환경변수에만 존재, 클라이언트 노출 없음
- 승인 게이트 우회 불가 — Notion 쓰기는 `/api/drafts/[id]/approve`·`/api/reports/[id]/approve` 뿐
- 하드 삭제 없음 — 모두 소프트 삭제(`is_active=false`)로 이력 보존
- 모든 생성·수정·승인·반려·설정 변경은 `activity_log`에 기록

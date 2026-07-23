# 팀보드 변경 지침서 v1.0 — Claude Code 핸드오프

> 기준 문서: `docs/SPEC.md` (통합 기준 문서 v1.0)
> 디자인 기준: `docs/prototype/index.html` (v0.3 프로토타입)
> 대상 저장소: `KwonJungHyeock/Teamboard_aiot`

---

## 0. 먼저 읽을 것 — 금지 사항

아래는 위반 시 되돌려야 하는 항목이다. 작업 전 반드시 확인한다.

| # | 금지 | 이유 |
|---|---|---|
| 1 | **비주얼을 코드로 재현하지 말 것** | 아이콘·일러스트·로고는 에셋 슬롯만 만들고 비운다. 인라인 SVG로 그림을 그리지 않는다 |
| 2 | **승인 라우트 외에 Notion 쓰기 코드 추가 금지** | `/api/drafts/[id]/approve`가 유일한 Notion 쓰기 경로다. 승인 게이트 우회 불가 원칙 |
| 3 | **LLM에 수치 생성 위임 금지** | 보고서의 모든 숫자·항목은 서버가 DB에서 집계한다. LLM은 문장화만 |
| 4 | **기존 추상화 레이어 시그니처 변경 금지** | `lib/auth.ts` `lib/llm.ts` `lib/notion.ts` `lib/activity.ts`의 공개 함수 시그니처 유지. 내부 구현만 확장 |
| 5 | **승인 없는 라이브러리 추가 금지** | 아래 허용 목록 외 추가 시 먼저 질문할 것 |
| 6 | **UI 컴포넌트 라이브러리 도입 금지** | 프로토타입이 순수 CSS로 완성돼 있다. shadcn·MUI·Chakra 등 도입 불필요 |
| 7 | **Phase 순서 건너뛰기 금지** | 스키마(Phase 1) 없이 화면부터 만들면 전부 되돌아간다 |

**허용 라이브러리**: `date-fns` (날짜 연산), `pptxgenjs` (Phase 9에서만). 그 외는 질문 후 진행.

---

## 1. 파일별 분류

### 유지 — 수정 없음

| 파일 | 비고 |
|---|---|
| `lib/auth.ts` | 세션·인증. SSO 전환 시 `authenticate()`만 교체 예정 |
| `lib/llm.ts` | 공급자 추상화. 그대로 재사용 |
| `lib/notion.ts` | Notion API. 그대로 재사용 |
| `lib/activity.ts` | 감사 로그 |
| `middleware.ts` | 접근 가드 (경로 추가만) |
| `vercel.json` | 프레임워크 명시 |
| `components/ApproveModal.tsx` | 승인 모달 — 보고서 승인에도 재사용 |
| `app/api/auth/*` | 인증 API 3종 |
| `app/api/assistant/*` | 부사수 위임·설정 |
| `app/api/drafts/[id]/approve`, `reject` | 승인 게이트 |
| `app/assistant/` | 화면 A — 내 부사수 |

### 수정

| 파일 | 작업 |
|---|---|
| `db/schema.sql` | 전면 개정 (Phase 1) |
| `scripts/init-db.mjs` | 신규 스키마 기준 시드 재작성 |
| `lib/types.ts` | 신규 객체 타입 추가 |
| `lib/db.ts` | 신규 테이블 쿼리 헬퍼 추가 |
| `lib/api.ts` | 클라이언트 페처 확장 |
| `components/Nav.tsx` | 사이드바 전면 교체 (Phase 2) |
| `components/ControlView.tsx` | 홈 대시보드로 흡수 후 삭제 (Phase 9) |
| `components/TimelineView.tsx` | 보조 뷰로 유지, 진입점만 강등 |
| `app/api/control/overview` | 홈 API로 확장 |
| `app/settings/` | 워크스페이스 설정 확장 |

### 신규

```
app/
  (dashboard)/page.tsx          홈
  calendar/page.tsx
  goals/page.tsx
  tasks/page.tsx
  projects/[id]/page.tsx
  signals/page.tsx
  huddle/page.tsx
  reports/page.tsx
  members/page.tsx
  api/
    projects/route.ts
    goals/route.ts, goals/[id]/route.ts
    tasks/route.ts, tasks/[id]/route.ts
    events/route.ts
    signals/route.ts, signals/[id]/route.ts, signals/[id]/comments/route.ts
    artifacts/route.ts
    reports/route.ts, reports/generate/route.ts, reports/[id]/approve/route.ts
    members/route.ts, members/[id]/route.ts
    home/summary/route.ts
components/
  Sidebar.tsx, CommandPalette.tsx
  MetricCards.tsx, TeamTimeline.tsx, TaskTable.tsx
  GoalTree.tsx, GoalProgress.tsx
  SignalPanel.tsx, SignalThread.tsx, HuddleFeed.tsx
  ReportView.tsx, ReportEditor.tsx
  MemberManager.tsx
lib/
  goals.ts        목표 집계·롤업 로직
  report.ts       월간 보고 집계 로직
  theme.css       디자인 토큰 (프로토타입에서 추출)
public/assets/
  texture/ brand/ illust/ motion/ avatar/
```

---

## 2. Phase별 작업 순서

각 Phase는 **완료 기준을 통과한 뒤** 다음으로 넘어간다.

---

### Phase 0 — 준비

1. 작업 브랜치 생성
2. `docs/SPEC.md`, `docs/CHANGE-GUIDE.md`, `docs/prototype/index.html` 커밋
3. `public/assets/` 하위 5개 폴더 생성, `texture/grain.png` `texture/mesh.webp` 배치
4. `lib/theme.css` 생성 — 프로토타입 `:root` 블록의 CSS 변수를 그대로 추출. **값을 임의로 바꾸지 않는다**

**완료 기준**: 기존 배포가 그대로 동작한다.

---

### Phase 1 — 스키마 전환

기준 문서 5장 테이블 정의를 그대로 구현한다.

1. `db/schema.sql` 개정
   - `users` → `actor`(type='human') + `account`
   - `assistants` → `actor`(type='agent', owner_actor_id) + `agent_config`
   - 신규: `project` `goal` `task` `goal_task` `event` `event_participant` `artifact` `task_artifact` `signal` `comment` `report` `config`
   - `drafts` 유지 + `task_type`에 `monthly_report` 허용
   - `app_settings` → `config` 개명
2. `scripts/init-db.mjs` 재작성
   - 권정혁(lead) · 박주희(member) · 조서연(member) → `actor` + `account`
   - 각자의 부사수 → `actor`(type='agent', owner_actor_id)
   - 프로젝트 3종 시드: EDUINO AI(`edu`) / Playino(`play`) / AI 트레이너(`train`)
   - `config` 기본값: 시그널 임계값 (decision 14 / review 7 / memo null / risk 0)
   - 여러 번 실행해도 안전하게 (기존과 동일하게 upsert)
3. `lib/types.ts` 타입 정의
4. `lib/db.ts` CRUD 헬퍼

**주의**: 실데이터가 없으므로 기존 데이터 마이그레이션 스크립트는 불필요하다. 드롭 후 재생성으로 진행한다.

**완료 기준**: `npm run db:init` 성공, 기존 `/assistant` 화면이 신규 스키마에서 정상 동작.

---

### Phase 2 — 공통 레이아웃

1. `lib/theme.css` 전역 적용
2. `components/Sidebar.tsx` — 프로토타입 구조 그대로
   - 그룹: 내 작업 / 프로젝트 / 협업 / 관리
   - `<details>` 기반 접기, 아이콘 모드 토글
   - 프로젝트 목록은 DB에서 렌더, 5개 초과 시 `전체 프로젝트 →`
   - `role !== 'lead'`면 관리 그룹 숨김
3. `components/CommandPalette.tsx` — `⌘K` / `Ctrl+K`
   - 이동·만들기·관리 항목, 텍스트 필터
   - 신규 화면 추가 시 여기에만 등록하면 되도록 배열 분리
4. `middleware.ts`에 신규 경로 가드 추가

**완료 기준**: 모든 기존 화면이 새 사이드바로 접근 가능. `⌘K` 동작.

---

### Phase 3 — 홈 + 캘린더

**이 Phase가 제품의 얼굴이다.** 프로토타입을 픽셀 단위로 따른다.

1. `GET /api/home/summary` — 지표 4종, 오늘 일정·업무, 이번 달 목표, 마감 임박, 시그널, 허들
2. `components/MetricCards.tsx` — 스파크라인 포함
3. `components/TeamTimeline.tsx` — **2층 레인**
   - 상단 행: `event` 시간축 블록. 겹치면 최대 2줄, 초과 `+N`
   - 하단 행: `task` 종일 칩. 5개까지, 초과 `+N`. 기한 임박 앞쪽 정렬
   - 현재 시각 인디케이터: 실시각 기준 위치 계산, 1분마다 갱신
   - 레인은 `actor`(type='human', is_active) 기준 동적 렌더
   - 일·주·월 토글: 주·월은 시간축을 날짜축으로 교체, 레인 구조 유지
4. `components/TaskTable.tsx` — 마감 임박, 컬럼 폭 고정
5. `app/(dashboard)/page.tsx` 조립
6. `app/calendar/page.tsx` — 동일 컴포넌트 확대판

**완료 기준**: 시드 데이터로 홈이 프로토타입과 동일하게 렌더. 팀원 추가 시 레인이 자동 증가.

---

### Phase 4 — 목표

1. `lib/goals.ts`
   - 월 목표 진척 = 연결된 Task 완료율 (`progress_mode='auto'`) 또는 수동 값
   - 분기 = 하위 월 평균, 연간 = 하위 분기 평균
   - 목표 미연결 Task는 집계에서 제외 (오류 아님)
2. `GET/POST /api/goals`, `PUT /api/goals/[id]`
3. `components/GoalTree.tsx` — 연간 > 분기 > 월 3단 트리, 접기
4. `components/GoalProgress.tsx` — 진척 바
5. `app/goals/page.tsx`
6. Task 상세에 목표 연결 UI (다중 선택, 선택 사항)

**완료 기준**: 월 목표에 Task를 연결하면 분기·연간 진척이 자동 갱신.

---

### Phase 5 — 업무 · 프로젝트 · 자료

1. `/api/tasks` CRUD. `status='proposed'`는 홈·캘린더에서 제외, 인박스에만 노출
2. `/api/projects`, `/api/artifacts`
3. `app/tasks/page.tsx` — 필터(프로젝트·담당·상태·기한), Phase 3의 테이블 패턴 재사용
4. `app/projects/[id]/page.tsx` — 개요·목표·업무·자료 탭
5. Artifact는 `{kind, title, url}` 링크 카드. **본문을 가져오지 않는다**

**완료 기준**: 프로젝트 상세에서 Notion·GitHub·Figma 링크가 한 곳에 모인다.

---

### Phase 6 — 시그널 · 허들

1. `/api/signals` CRUD, `/api/signals/[id]/comments`
2. 정체 판정: `config`의 타입별 임계값과 `status='discussing'` 경과일 비교. 하드코딩 금지
3. `components/SignalPanel.tsx` — 타입 필터, 정체 항목 상단 고정
4. `components/SignalThread.tsx` — 코멘트 스레드
5. `components/HuddleFeed.tsx`
   - `scope='private'` → `huddle` 전환 = 허들로 보내기
   - `type='memo'` → `decision` 전환 = 결정으로 승격 (코멘트 유지)
   - 결정 → Task 생성 시 `signal.task_id` 연결
6. `app/signals/page.tsx`, `app/huddle/page.tsx`

**완료 기준**: 메모 → 허들 → 결정 → Task 경로가 끊김 없이 이어지고, 코멘트가 전 과정에서 보존된다.

---

### Phase 7 — 월간 보고

**기존 drafts 파이프라인을 재사용한다. 새 승인 로직을 만들지 않는다.**

1. `lib/report.ts` — 집계 함수. 입력은 `(year, month)`, 출력은 구조화된 JSON
   ```
   { goals[], completed[], incomplete[], decisions[], risks[], nextGoals[], nextTasks[] }
   ```
   **모든 값은 DB 쿼리로 산출한다**
2. `POST /api/reports/generate`
   - `lib/report.ts`로 집계 → 그 JSON을 프롬프트에 넣어 `lib/llm.ts` 호출
   - LLM 지시: "주어진 데이터만 사용하여 문장화하라. 수치를 만들거나 추론하지 말라"
   - 결과를 `drafts(task_type='monthly_report', status='pending')`에 저장
   - `report` 레코드 생성, `content`에 집계 JSON 원본 보관
3. `components/ReportView.tsx` — 기준 문서 3.2의 6개 섹션 고정
4. `components/ReportEditor.tsx` — 승인 전 텍스트 수정
5. `POST /api/reports/[id]/approve` — 기존 승인 라우트 재사용, Notion 기록
6. `app/reports/page.tsx` — 월별 목록 + 상세
7. PDF: 인쇄용 CSS (`@media print`). 별도 라이브러리 불필요

**완료 기준**: 임의의 달을 선택해 생성하면 6개 섹션이 채워진 초안이 나오고, 승인 시 Notion에 기록된다. 보고서의 모든 숫자가 DB 값과 일치한다.

---

### Phase 8 — 구성원 관리

1. `/api/members` — lead 전용
   - 계정 발급: 이메일 + 임시 비밀번호 생성, `must_change_pw=true`
   - 비활성화: `is_active=false` (삭제 금지)
   - 부사수 자동 생성 (`actor` type='agent', `owner_actor_id` 연결)
2. `components/MemberManager.tsx`
3. 최초 로그인 시 비밀번호 변경 강제 플로우
4. `app/members/page.tsx`

**완료 기준**: lead가 신규 계정을 발급하면 캘린더 레인이 자동으로 늘어난다.

---

### Phase 9 — 정리

1. `components/ControlView.tsx` 삭제 — 홈으로 흡수 완료 확인 후
2. `/api/control/overview` → `/api/home/summary`로 통합
3. `/timeline` 유지하되 사이드바 최하단 배치
4. 미사용 코드·타입 정리
5. `README.md` 갱신
6. (선택) PPTX 내보내기 — `pptxgenjs`, 6슬라이드 고정 템플릿

**완료 기준**: 중복 화면 없음. 빌드 경고 없음.

---

## 3. 공통 구현 규칙

### 데이터
- 모든 조회는 `is_active=true` 필터 기본 적용
- `status='proposed'` Task는 홈·캘린더·타임라인에서 제외
- 삭제는 소프트 삭제. 하드 삭제 API를 만들지 않는다
- 목표 미연결 Task를 오류로 취급하지 않는다

### UI
- 프로토타입의 CSS 변수만 사용. 하드코딩 색상 금지
- 브랜드 레드(`#E31E24`)는 로고·주요 CTA 솔리드에만. 경고에는 `#F87171` + 라벨 동반
- 에이전트 생성물은 4중 구분: 좌측 바이올렛 보더 · 봇 태그 · 투명도 90% · `승인 대기` 배지
- 아이콘은 인라인 SVG 스트로크 방식 유지 (프로토타입과 동일)
- 일러스트·로고 자리는 슬롯만 만들고 비운다

### 접근성
- 키보드 포커스 표시 유지 (`:focus-visible`)
- `prefers-reduced-motion` 존중
- 아이콘 단독 버튼에 `aria-label`

### 감사
- 생성·수정·승인·반려·설정 변경은 모두 `activity_log`에 기록

---

## 4. 진행 보고 방식

각 Phase 완료 시 아래를 남긴다.

1. 변경 파일 목록
2. 완료 기준 충족 여부
3. 기준 문서와 어긋난 부분과 그 이유
4. 판단이 필요한 열린 질문

**기준 문서와 다르게 구현해야 할 이유를 발견하면, 임의로 진행하지 말고 질문한다.** 기준 문서는 개정 가능하되 기록을 남긴다.

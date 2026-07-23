# 팀보드 통합 기준 문서 v1.1

| 항목 | 내용 |
|---|---|
| 상태 | **확정** — 이 문서가 유일한 기준. 기존 `docs/DEVELOPMENT.md`와 기획 문서 v0.1을 대체 |
| 최종 수정 | 2026-07-24 (v1.1 — Phase 5~8 구현 반영) |
| 소유 | 권정혁 (플랫폼사업팀) |
| 배포 | https://teamboard-aiot.vercel.app |
| 저장소 | https://github.com/KwonJungHyeock/Teamboard_aiot |

---

## 1. 제품 정의

AIoT 교육플랫폼 사업팀(ROBODYNE SYSTEMS)의 **메인 업무관리 도구**.

세 가지를 하나의 흐름으로 잇는다.

```
목표 설정 (연간 → 분기 → 월)
   ↓  목표에 업무를 연결
일상 실행 (캘린더 · 업무 · 시그널 · 부사수 위임)
   ↓  실행 결과가 자동 집계
월간 보고 (수행 실적 + 다음달 계획 자동 초안 → 승인 → 문서화)
```

핵심 명제: **일하면서 기록하면 보고서가 저절로 쌓인다.**

### 1.1 레이어 분담

| 레이어 | 도구 | 책임 | 개발 |
|---|---|---|---|
| 기록 | Notion | 문서·교육 리소스 보관, 승인 확정본 미러 | 연동만 |
| 통제 | **팀보드** | 목표·상태·기한·담당·일정·결정·보고 | **개발 대상** |
| 알림 | Discord | 이벤트 푸시 | 2차 |

### 1.2 Notion 방향 — 확정 (D-011)

**자체 DB가 원본, Notion은 단방향 미러.**

- 승인된 확정본을 Notion 타임라인 DB에 기록 — **기존 코드 그대로 유지**
- 팀 타임라인 화면은 자체 DB에서 읽음 (Notion 조회는 보조 뷰로 강등)
- Notion에서 수정해도 팀보드로 되돌아오지 않음 → 충돌 해결 로직 불필요

이유: 캘린더 2층 레인, 시그널 4타입, 허들 코멘트, 목표 트리는 Notion 속성으로 표현할 수 없다. 그러나 대표님·타 팀은 Notion으로 계속 조회해야 한다. 단방향 미러가 두 요구를 동시에 만족시킨다.

---

## 2. 도메인 모델

### 2.1 코어 객체 5종

| 객체 | 정의 |
|---|---|
| **Goal** | 연간·분기·월 목표. 상위-하위 트리 구조 |
| **Project** | 산출물이 있는 단위 (EDUINO AI, Playino, AI 트레이너) |
| **Task** | 담당자·기한이 있는 실행 단위 |
| **Artifact** | 외부 산출물 참조 (Notion·GitHub·Figma·파일) |
| **Signal** | 결정·확인 요청·메모·리스크 |

연결 관계: `Goal ← Task → Project → Artifact`, `Signal`은 어디에나 부착.

### 2.2 Goal 체계

| 주기 | 개수 기준 | 진척 산출 |
|---|---|---|
| 연간 | 3~5개 | 하위 분기 목표 평균 |
| 분기 | 목표당 2~4개 | 하위 월 목표 평균 |
| 월 | 목표당 2~4개 | 연결된 Task 완료율 (수동 덮어쓰기 가능) |

**설계 원칙**
- 월 목표에만 Task를 직접 연결한다. 분기·연간은 집계만 한다
- Task는 여러 목표에 연결될 수 있다 (N:M)
- 수치 목표(예: 키트 판매 200대)는 `target_value` / `current_value` 수동 입력을 허용한다. R&D 목표 상당수는 수치화되지 않기 때문
- 목표에 연결되지 않은 Task도 허용한다. 강제하면 입력이 멈춘다
- **진척률 산식(v1.1 확정, D-018)**: `done / (연결 Task 수 − dropped 수)`. 중단(dropped)된 Task는 분모에서 제외한다. 연결 Task가 전부 dropped이거나 auto 모드에 연결 Task가 0개면 산출 불가로 `null`("-")을 표시한다. `proposed` 상태 Task는 집계 대상이 아니다.

### 2.3 Signal 4타입

| 타입 | 용도 | 공개 범위 | 정체 임계값 |
|---|---|---|---|
| decision | 방향 확정 필요 | 팀 전체 | 14일 |
| review | 리뷰·회신 요구 | 작성자 + 지정 대상(`target_actor_id`) + lead | 7일 (대상 미확인 기준) |
| memo | 개인 기록 | 본인만 | 없음 |
| risk | 기술 위험 플래그 | 팀 전체 | 즉시 상단 고정 |

임계값은 `config` 테이블로 분리 (코드 배포 없이 조정). config 키: `signal_thresholds`(타입별), `signal_decided_stale_days`(미실행 결정 임계, 기본 7).

**생명주기 (v1.1 확정, D-019)**: `제기됨(open) → 논의중(discussing) → 결정됨(decided) → 반영됨(resolved, Task 생성)` 또는 `기각됨(archived)`. 반드시 종료된다.
- `decided`(결정됐으나 Task 미생성)와 `resolved`(Task 생성 완료)를 분리한다. "결정만 하고 아무도 실행하지 않은" 누수를 잡기 위함이다.
- `decided`가 `signal_decided_stale_days` 이상 지속되면 **미실행 결정**으로 홈 시그널 패널 상단에 노출한다.
- `resolved`로의 전환은 `createTask`(결정→Task 반영) 성공 시에만 자동으로 일어난다.
- `review`는 대상(`target_actor_id`)이 확인 완료하면 `resolved`가 된다. review 생성 시 대상 지정은 필수다.

### 2.4 허들

개인 메모를 팀과 공유해 코멘트를 받는 통로. 별도 객체가 아니라 `signal.scope` 값이다.

```
메모(private) → [허들로 보내기] → huddle, 코멘트 스레드
  → [결정으로 승격] → decision → Task 생성
```

메모에 달린 코멘트가 결정 근거로 그대로 따라 올라간다.

**허들 피드 조회 기준 (v1.1 확정, D-020)**: 허들로 보낸 시각을 `signal.huddle_at`에 기록하고 이후 삭제하지 않는다. 허들 피드는 `scope`가 아니라 `huddle_at IS NOT NULL`로 조회한다. 따라서 메모가 결정으로 승격돼 `scope`가 `team`으로 바뀌어도 흐름(메모→허들→결정→반영)이 허들에 그대로 남는다. `scope`는 순수 가시성 제어로만 쓴다.

### 2.5 Actor 모델

사람과 부사수를 `actor` 하나로 통합하고 `type`으로 구분한다.

**규칙: 에이전트는 제안만, 확정은 사람만.**

| 행위 | human | agent |
|---|---|---|
| Task·보고서 초안 생성 | O | O (`proposed`/`pending` 상태로만) |
| 상태 변경·승인 | O | X |
| 시그널·코멘트 작성 | O | O |
| 결정 확정 | O (lead) | X |

UI 구분 4중: 좌측 바이올렛 보더 · 봇 태그 · 투명도 90% · `승인 대기` 배지.

---

## 3. 월간 보고 자동화

팀장의 월간 보고(수행 실적 + 다음달 계획)를 **기존 부사수 승인 게이트로 처리한다.** 새 파이프라인을 만들지 않는다.

### 3.1 흐름

```
1. 매월 말 → [월간 보고 생성] (또는 자동 트리거)
2. 서버가 집계:
     - 이번 달 목표와 달성률
     - 완료된 Task (목표별 분류)
     - 미완료 Task와 사유
     - 결정된 Signal
     - 프로젝트 진척 델타
     - 다음 달 목표와 예정 Task
3. LLM이 보고서 초안 생성 → drafts(task_type='monthly_report', status='pending')
4. 팀장 검토·수정 → [승인]
5. 승인 시: report 레코드 확정 + Notion 기록 + 내보내기 활성화
```

### 3.2 보고서 구조 (고정 템플릿)

```
1. 이번 달 목표 달성 현황     ← goal 집계, 달성률 표
2. 주요 수행 실적            ← 완료 Task를 목표별로 그룹
3. 미달 항목 및 사유          ← 미완료 Task + 지연 사유
4. 주요 결정 사항            ← decision 타입 signal
5. 리스크 및 이슈            ← risk 타입 signal
6. 다음 달 목표 및 계획       ← 다음 달 goal + 예정 Task
```

**LLM의 역할은 문장화뿐이다.** 숫자와 항목은 서버가 DB에서 집계한다. 수치를 LLM이 생성하면 안 된다.

### 3.3 내보내기

| 형식 | 우선순위 | 방법 |
|---|---|---|
| 웹 보고서 화면 | 1차 | 그대로 화면 공유 가능 |
| PDF | 1차 | 브라우저 인쇄 CSS |
| Notion 페이지 | 1차 | 기존 승인 라우트 재사용 |
| **PPTX** | 1차 후반 | `pptxgenjs`, 고정 템플릿 6슬라이드 |

PPTX는 자유 편집이 아니라 **고정 템플릿 채우기**로 한정한다. 자유 레이아웃을 지원하려 하면 범위가 폭발한다.

---

## 4. 화면 구성

| 경로 | 화면 | 접근 | 상태 |
|---|---|---|---|
| `/login` | 로그인 | - | 기존 유지 |
| `/` | **홈 대시보드** | 전원 | **신규** — 기존 `/control` 흡수 |
| `/calendar` | 캘린더 (일·주·월) | 전원 | **신규** |
| `/goals` | 목표 트리 (연간·분기·월) | 전원 | **신규** |
| `/reports` | 월간 보고 | lead | **신규** |
| `/tasks` | 업무 목록 | 전원 | **신규** |
| `/projects` | 전체 프로젝트 인덱스 (카드 그리드) | 전원 | **신규 (v1.1 추가)** |
| `/projects/[id]` | 프로젝트 상세 + 자료 | 전원 | **신규** |
| `/signals` | 시그널 | 전원 | **신규** |
| `/huddle` | 허들 | 전원 | **신규** |
| `/assistant` | 내 부사수 | 전원 | **기존 유지** |
| `/timeline` | Notion 타임라인 (보조) | 전원 | 기존, 강등 |
| `/settings` | 연동·워크스페이스 설정 | lead | 기존 확장 |
| `/members` | 구성원·계정 발급 | lead | **신규** |

### 4.1 홈 대시보드 구성

1. 지표 카드 4종 (진행 업무 / 이번 주 완료 / 평균 결정 소요 / 지연·정체) + 스파크라인
2. **팀 타임라인 (시그니처)** — 캘린더 2층 레인, 현재 시각 인디케이터. 각 레인 담당자 이름 옆에 부사수 상태 점(작동중 펄스 / 보고 대기 바이올렛 / 대기 무표시)
3. 마감 임박 테이블

**오른쪽 컬럼 카드 순서 (v1.1 확정)**: 이번 달 목표 진척 → 프로젝트 진행(구 `/control` "프로젝트별 진행률" 흡수, W주차) → 시그널 패널(타입 필터) → 허들 피드.

### 4.2 캘린더 2층 레인

일정과 업무는 성격이 달라 같은 축에 올리지 않는다.

| 구분 | 시각 정보 | 표현 | 병행 |
|---|---|---|---|
| 일정 (Event) | 시작·종료 시각 있음 | 시간축 블록 | 드묾 |
| 업무 (Task) | 기한만 있음 | 종일 칩, 가로 나열 | 항상 |

레인 = 상단 행(시간 블록) + 하단 행(업무 칩). 병행 업무가 늘어도 레인 높이가 증가하지 않는다.

**보조 규칙**
- 시간 일정 겹침은 상단 행 최대 2줄 확장, 초과분 `+N`
- 업무 칩 5개까지 노출, 초과분 `+N`. 기한 임박 항목 앞쪽 정렬
- 레인은 `actor` 기반 동적 렌더. 팀원 추가·비활성화 지원

### 4.3 내비게이션

좌측 사이드바 + 그룹 접기 + `⌘K` 커맨드 팔레트.

**확장 원칙: 사이드바에는 자주 쓰는 것만, 나머지는 팔레트에.** 기능이 늘어날 때 사이드바에 계속 추가하지 않는다.

**사이드바 그룹 구조 (v1.1 실제 구현)**
- **내 작업**: 홈 · 내 업무 · 캘린더 · 내 부사수
- **목표·보고**: 목표 · 월간 보고(lead)
- **프로젝트(동적)**: 프로젝트를 최대 5개까지 직접 나열하고, 항상 **"전체 프로젝트 →"**(`/projects` 인덱스) 진입 경로를 노출한다. "5개 초과일 때만"이 아니라 항상 노출한다.
- **협업**: 시그널 · 허들
- **관리(lead)**: 구성원 · 설정 · Notion 타임라인(최하단, 보조 화면)

---

## 5. 데이터 스키마

### 5.1 기존 테이블 전환

| 기존 | 전환 |
|---|---|
| `users` | `actor`(type=human) + `account` 분리 |
| `assistants` | `actor`(type=agent) + `agent_config` |
| `drafts` | 유지 + `task_type`에 `monthly_report` 추가 |
| `activity_log` | 유지 |
| `app_settings` | `config`로 개명 |

**스키마 정리는 지금 해야 한다.** 실데이터가 아직 없고 시드만 있는 상태라 마이그레이션 비용이 0에 가깝다. 운영 시작 후에는 훨씬 비싸진다.

### 5.2 테이블 정의

| 테이블 | 주요 컬럼 |
|---|---|
| `actor` | id PK, type(human\|agent), display_name, **short_name(nullable, 호칭용)**, owner_actor_id FK, avatar_url, is_active |
| `account` | actor_id PK, email, password_hash, role(lead\|member\|viewer), must_change_pw, notion_user_id, last_login_at |
| `agent_config` | actor_id PK, report_style, work_areas JSONB, auto_scope, system_prompt_extra |
| `project` | id PK, name, status, start_date, end_date, color_key, notion_url |
| `goal` | id PK, parent_id FK, period_type(year\|quarter\|month), period_start, period_end, title, description, target_metric, target_value, current_value, progress_mode(auto\|manual), progress, owner_actor_id FK, project_id FK |
| `task` | id PK, project_id FK, title, description, status, assignee_id FK, due_date, priority, origin(human\|agent), created_by FK, completed_at, **drop_reason(dropped 전환 시 필수)**, **dropped_at(중단 시각, 월간 보고 월 경계 판정)** |
| `goal_task` | goal_id FK, task_id FK |
| `event` | id PK, project_id FK, title, start_at, end_at, is_team, created_by FK |
| `event_participant` | event_id FK, actor_id FK |
| `artifact` | id PK, project_id FK, kind, title, url, external_updated_at |
| `task_artifact` | task_id FK, artifact_id FK |
| `signal` | id PK, type, scope, title, body, author_id FK, **target_actor_id FK(review 필수)**, project_id FK, task_id FK, status, resolved_at, **decided_at(결정 시각)**, **huddle_at(허들 공유 시각, 허들 피드 조회 기준)** |
| `comment` | id PK, signal_id FK, author_id FK, body, created_at |
| `report` | id PK, period_year, period_month, draft_id FK, content JSONB, status, approved_by FK, notion_page_id, approved_at |
| `drafts` | 기존 유지 + task_type 확장 |
| `activity_log` | 기존 유지 |
| `config` | key PK, value JSONB, updated_by |

### 5.3 enum

**모든 enum 컬럼은 DB 레벨 `CHECK` 제약을 건다 (v1.1 확정, D-021).** 애플리케이션 검증만으로는 잘못된 값이 조용히 들어갈 수 있다.

| 컬럼 | 값 |
|---|---|
| `actor.type` | human / agent |
| `account.role` | lead / member / viewer |
| `project.status` | active / done / hold |
| `task.status` | proposed / todo / doing / review / done / dropped |
| `task.origin` | human / agent |
| `task.priority` | high / mid / low |
| `goal.period_type` | year / quarter / month |
| `goal.progress_mode` | auto / manual |
| `signal.type` | decision / review / memo / risk |
| `signal.scope` | private / huddle / team |
| `signal.status` | open / discussing / **decided** / resolved / archived |
| `artifact.kind` | notion / github / figma / file / link |
| `drafts.task_type` | 기존 4종 + monthly_report |
| `drafts.status` | working / pending / approved / rejected / failed |
| `report.status` | draft / approved |
| `activity_log.level` | info / success / warn / error |

---

## 6. 권한

| 역할 | 범위 |
|---|---|
| lead | 계정 발급·비활성화, 프로젝트·목표 생성·보관, 결정 종결, 월간 보고 승인, Notion 연동 범위 변경 |
| member | 일반 업무·시그널 작성/수정 전권, 본인 부사수 초안 승인, 허들 참여 |
| viewer | 읽기 + 코멘트 |

**"member 전권"의 범위 명확화 (v1.1, D-022)** — member의 전권은 *일반 업무·시그널 작성/수정*에 한한다. 아래 두 가지는 별도 제한이 적용된다.
- **proposed Task 승인·기각**: 담당자 본인 또는 lead만. (drafts 승인 규칙 "본인 또는 팀장"과 일치. 권한 없으면 403)
- **decision 종결**(decided/archived 전환, Task 반영): 작성자 본인 또는 lead만. `review` 종결(확인 완료)은 대상자(`target_actor_id`) 또는 lead만.
- 그 밖의 시그널 타입(memo/risk) 상태 전이와 일반 Task 관리는 member 전권 유지.

**구성원 관리 (Phase 8)**
- 계정은 lead가 직접 발급 (이메일 + `short_name` + 임시 비밀번호 → 최초 로그인 시 변경 강제). 발급 시 부사수 actor가 자동 생성된다.
- 퇴사·비활성화는 삭제가 아닌 `is_active = false` (담당자 이력 보존). 하드 삭제 API는 없다.
- **lead 가드 2개**: ① lead는 본인을 비활성화할 수 없다 ② 활성 lead가 1명뿐이면 그 lead의 강등·비활성화 불가.
- 메일플러그 SSO 확정 시 `lib/auth.ts`의 `authenticate()`만 교체

---

## 7. 보안 원칙 (기존 유지)

1. Notion 토큰·LLM 키는 서버 환경변수에만
2. Notion 접근은 지정 data source 1개로 한정, 범위 변경은 `role=lead`만
3. **Notion 쓰기는 승인 라우트 단일 경로** — 우회 불가
4. Notion 페이지 삭제 API 미사용
5. 모든 로그인·위임·승인·반려·설정 변경은 `activity_log` 기록
6. 비밀번호 scrypt 해시, 세션 HMAC-SHA256 서명 쿠키(httpOnly)
7. 미들웨어 + 서버측 세션 검증 이중 가드

---

## 8. 디자인 시스템

### 8.1 색상

| 토큰 | 값 | 용도 |
|---|---|---|
| `brand` | `#E31E24` | **에듀이노 브랜드 레드** — 로고, 주요 CTA 솔리드 채움 |
| `bg-canvas` | `#070A11` | 페이지 |
| `bg-surface` | `#0D121E` | 카드 |
| `bg-elevated` | `#141A28` | 상위 카드·모달 |
| `line` | `rgba(255,255,255,.07)` | 테두리 |
| `text-hi/mid/lo` | `#EAEEF7` / `#98A2B8` / `#5C6680` | 본문 / 보조 / 메타 |
| `edu` | `#4B8DF8` | EDUINO AI 프로젝트 |
| `play` | `#8B5CF6` | Playino 프로젝트 |
| `train` | `#2DD4BF` | AI 트레이너 프로젝트 |
| `warn` | `#F5A524` | 임박 |
| `danger` | `#F87171` | 지연·정체·리스크 |

### 8.2 레드 용법 분리 규칙 (중요)

브랜드 레드와 경고 레드는 **색이 아니라 용법으로 구분한다.**

| 용도 | 표현 |
|---|---|
| 브랜드 (`#E31E24`) | 로고, 주요 CTA. **큰 면적 솔리드 채움**, 흰 글자 |
| 경고 (`#F87171`) | 작은 점·좌측 보더·배지. **반드시 아이콘 또는 텍스트 라벨 동반** |

색 하나에만 의존하지 않는 것이 핵심이다. 경고를 색으로만 표시하면 브랜드 레드에 묻힌다.

### 8.3 타이포

| 역할 | 서체 |
|---|---|
| UI | Pretendard |
| 데이터 (수치·시간축·날짜·ID) | JetBrains Mono |

### 8.4 기타

- 카드 radius 14px, 내부 요소 9px
- 테두리 1px
- 글로우 허용: 진행률 바, 타임라인 블록, 현재 시각 인디케이터, 시그널 점
- 글로우 금지: 본문 텍스트, 리스트 행, 입력 폼, 테이블

### 8.5 에셋 슬롯

| ID | 파일 | 상태 |
|---|---|---|
| T-1 | `assets/texture/grain.png` (256×256) | 완료 |
| T-2 | `assets/texture/mesh.webp` (2400×1400) | 완료 |
| B-1 | `assets/brand/wordmark.svg` | 대기 |
| I-1~3 | `assets/illust/empty-*.png` (800×800 투명) | 대기 |
| M-1 | `assets/motion/agent-thinking.json` | 선택 (CSS 폴백 동작 중) |

---

## 9. 결정 로그

| ID | 결정 | 근거 |
|---|---|---|
| D-001 | ~~Notion은 문서 저장소로만~~ → **D-011로 대체** | 기존 구현 미확인 상태의 결정 |
| D-002 | Task 생성은 하이브리드 (에이전트 초안 + 사람 승인) | 노이즈를 승인 게이트로 차단 |
| D-003 | 홈은 캘린더 기반, 일 단위 기본 / 주·월 옵션 | 전체 스케줄 파악이 팀장 관점 1순위 |
| D-004 | 캘린더 레인 2층 분리 | 병행 업무 4개 이상에서 시간축 모델 붕괴 |
| D-005 | 팀원 레인 동적 추가, 삭제는 비활성화 | 담당자 이력 보존 |
| D-006 | 시그널 4타입 + 타입별 임계값 | 결정과 메모의 요구가 정반대 |
| D-007 | 허들은 `signal.scope` 값 | 객체 증가 없이 결정 근거 추적 |
| D-008 | 에이전트를 actor로 통합, 제안 권한만 | 기록 추적 일원화 + 오작동 차단 |
| D-009 | 자체 계정, lead 직접 발급 | 관리 주체 명확화 |
| D-010 | 다크 글래스, 글로우는 데이터 영역 한정 | 장시간 텍스트 작업 가독성 |
| **D-011** | **Notion은 단방향 미러, 자체 DB가 원본** | 캘린더·시그널·허들·목표는 Notion으로 표현 불가. 승인 게이트 코드는 그대로 유지 |
| **D-012** | **월간 보고를 기존 drafts 파이프라인으로 처리** | 새 파이프라인 불필요, 승인 게이트 재사용 |
| **D-013** | **보고서 수치는 서버가 집계, LLM은 문장화만** | LLM이 수치를 생성하면 보고 신뢰성 붕괴 |
| **D-014** | **Task의 목표 연결은 선택 사항** | 강제하면 입력이 멈춤 |
| **D-015** | **PPTX는 고정 템플릿 채우기로 한정** | 자유 레이아웃 지원 시 범위 폭발 |
| **D-016** | **브랜드 레드와 경고 레드는 용법으로 구분** | 색 하나에 의존하면 경고가 묻힘 |
| **D-017** | **스키마 정리를 운영 전환 전에 수행** | 실데이터 없는 지금이 최저 비용 시점 |
| **D-018** | **진척률 분모에서 dropped Task 제외 + drop_reason 필수** | 중단 업무를 분모에 남기면 진척률이 영구 왜곡. 사유 필수로 "중단시켜 진척률 올리기" 우회 차단 |
| **D-019** | **signal.status에 decided 추가 (5값)** | "결정만 하고 실행 안 한" 누수를 task_id 유추가 아니라 상태로 명시해야 조회·알림이 강해짐 |
| **D-020** | **허들 피드는 huddle_at으로 조회, scope는 가시성 전용** | 승격돼 scope가 바뀌어도 메모→결정 흐름이 허들에 남아야 기능 존재 이유가 성립 |
| **D-021** | **enum 전 컬럼에 DB CHECK 제약** | 앱 검증만으로는 잘못된 값이 조용히 유입 |
| **D-022** | **proposed 승인·decision 종결 권한을 member 전권에서 분리** | 제안 승인 규칙이 제품 내에서 두 가지면 혼란. drafts 승인 규칙(본인·팀장)과 일치시킴 |

---

## 10. 이번 릴리즈 범위 (스코프 동결)

아래까지 완성 후, 기능은 하나씩 추가한다.

### 포함
- 스키마 전환 (actor / account / goal / task / event / artifact / signal / comment / report)
- 홈 대시보드 (지표·캘린더·목표·마감임박·시그널·허들)
- 캘린더 화면 (일·주·월)
- 목표 화면 (연간·분기·월 트리, 진척)
- 업무 화면 (목록·상세)
- 프로젝트 상세 (자료 연결)
- 시그널·허들
- 월간 보고 (생성·승인·PDF·Notion)
- 구성원 관리 (계정 발급)
- 기존 `/assistant` 유지, `/timeline` 보조 뷰로 유지

### 제외 (이후 순차 추가)
- ~~PPTX 내보내기~~ → **v1.1에서 구현 완료**
- Discord 연동
- 팀장 → 팀원 업무 지시
- **다중 Notion DB 연동** (v1.2 후보)
- 부사수 간 조율
- 자료조사 웹 검색 연동
- 허들 코멘트에 에이전트 자동 참여
- **메일플러그 SSO** (v1.2 후보 — `lib/auth.ts` `authenticate()` 교체 지점만 준비됨)
- **시그널 review 다중 수신자** (v1.2 후보 — 현재 `target_actor_id` 단일 대상)
- 비활성 사용자 세션은 서버측 라이브 검증으로 즉시 무효화됨 (v1.1). API 무상태 토큰의 role 반영은 페이지·민감 API에서 라이브 조회로 처리

---

## 11. 운영 전환 체크리스트 (순서 중요)

**아래 순서를 지킬 것. 순서가 어긋나면 DB를 두 번 초기화하게 된다.** 각 단계에 "건너뛰면?"을 명시한다.

1. **Notion 통합 토큰 발급** (워크스페이스 소유자 권한 — 리드타임 가장 김)
   - 건너뛰면? 승인 시 Notion 페이지 생성이 전부 실패한다.
2. **Notion 타임라인 DB 속성 허용값 확인** (구분·업무유형·업무 구분·상태·우선순위)
   - 토큰 발급 후 `GET /api/admin/verify-notion-schema`(임시)로 코드 허용값과 실제 선택지를 대조.
   - 건너뛰면? 운영 첫날 승인 시점에 "선택지 없음"으로 페이지 생성이 실패한다. 이미 팀원이 쓰기 시작한 뒤라 대응 비용이 크다.
3. **`scripts/init-db.mjs`의 실제 업무메일 + Notion person ID 교체 → 커밋 → 배포** (초기화 *전에* 반드시)
   - 건너뛰면? 시드 이메일은 초기화 시점에 읽히므로, 초기화 후 바꾸면 재초기화가 필요하다.
4. **Vercel 환경변수 등록**: `NOTION_TOKEN` / `OPENAI_API_KEY`(또는 `ANTHROPIC_API_KEY`) / `ALLOW_DB_INIT=true`
   - 건너뛰면? 키가 없으면 부사수·보고가 데모 모드로 뜨고, `ALLOW_DB_INIT`이 없으면 초기화 라우트가 404다.
5. **`curl POST /api/admin/init-db` 실행 → 프로덕션 초기화** (스키마 + 운영 시드 + 데모 시드)
   - 건너뛰면? DB가 비어 있어 로그인·화면이 동작하지 않는다.
6. **임시 라우트(`app/api/admin/*`) + `ALLOW_DB_INIT` 즉시 제거 → 커밋**
   - 건너뛰면? 초기화·검증 라우트가 계속 노출된다(이중 잠금은 있으나 제거가 원칙).
7. **팀원 초기 비밀번호 전달** (최초 로그인 시 변경 강제)
   - 건너뛰면? 팀원이 로그인할 수 없다.

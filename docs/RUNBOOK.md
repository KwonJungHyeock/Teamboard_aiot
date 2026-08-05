# RUNBOOK — Mission Deck 운영

대상: 팀장(운영 담당). 배포·롤백·장애 1차 대응을 이 문서 하나로 처리한다.
작성 2026-08-04 (MD-P-2026-015 §E)

---

## 0. 한 장 요약

| 상황 | 먼저 할 것 |
|------|-----------|
| 배포하고 싶다 | `main`에 머지 → Vercel 자동 배포. §1 |
| 방금 배포가 잘못됐다 | Vercel에서 직전 배포로 **Instant Rollback**. §2 |
| 화면이 안 뜬다 | §4-A 5분 점검 |
| 목표 달성률이 안 움직인다 | §3 스냅샷 크론 확인 |
| 데이터를 잘못 지웠다 | §5 복구. **먼저 쓰기를 멈춘다** |

---

## 1. 배포

### 정상 경로

1. 작업 브랜치에서 개발 → PR
2. **CI(e2e 스모크)가 초록인지 확인** — `.github/workflows/e2e.yml`
   로그인 → 홈 진입 · 404 화면 · member 권한 차단을 검사한다. 빨간 상태로 머지하지 않는다.
3. `main`에 머지 → Vercel이 자동 배포
4. 배포 후 **스모크 6화면**을 눈으로 확인: 로그인 → 홈 → 활동 → 프로젝트 상세 → 목표 → 월간 보고

### 스키마 변경이 있는 배포

마이그레이션은 **첫 DB 접근 시 자동 적용**된다(`lib/migrate.ts`). 별도 명령이 필요 없다.

- 파일은 `db/migrations/NNNN_이름.sql`, 번호 오름차순으로 적용된다.
- 적용 이력은 `schema_migrations` 테이블에 남는다.
- **되돌리는 마이그레이션은 없다.** 컬럼 삭제·타입 변경처럼 위험한 변경은
  add-only(새 컬럼 추가 + 나중에 정리)로 쪼개서 낸다.

확인:
```sql
SELECT filename, applied_at FROM schema_migrations ORDER BY filename DESC LIMIT 5;
```

### 환경변수

| 이름 | 필수 | 용도 |
|------|:---:|------|
| `DATABASE_URL` | ✅ | Postgres 연결 문자열 |
| `AUTH_SECRET` | ✅ | 세션 서명 키. 바꾸면 **전원 로그아웃**된다 |
| `SEED_DEFAULT_PASSWORD` | | `db:init` 시드 계정 초기 비밀번호 |
| `CRON_SECRET` | 권장 | 스냅샷 크론 인증. 없으면 Vercel 내부 호출만 허용 |
| `NOTION_TOKEN` | | Notion 리소스 연동. 없으면 관련 UI가 안내 상태로 표시 |
| `BLOB_READ_WRITE_TOKEN` | | 이미지 업로드. 없으면 업로드 UI가 비활성 |

**모두 서버 전용이다.** `NEXT_PUBLIC_` 접두사를 붙이지 않는다 — 붙이면 브라우저로 새어나간다.

---

## 2. 롤백

### 코드만 되돌리면 되는 경우 (대부분)

Vercel 대시보드 → 해당 프로젝트 → **Deployments** → 직전 정상 배포 → **⋯ → Promote to Production**.
빌드를 다시 하지 않으므로 **30초 안에** 끝난다.

### 스키마까지 얽힌 경우

마이그레이션은 자동 롤백되지 않는다. 순서를 지킨다.

1. 먼저 **코드를 롤백**한다(위).
2. 새 컬럼이 남아 있어도 예전 코드는 그것을 읽지 않으므로 대개 그대로 동작한다.
3. 정말 스키마를 되돌려야 하면 **역방향 마이그레이션을 새로 작성**해 다음 배포에 싣는다.
   `schema_migrations`에서 줄을 지우고 되돌리는 방식은 쓰지 않는다 — 이력이 어긋난다.

### git 되돌리기

```bash
git revert <문제 커밋>        # 이력을 남기며 되돌린다 (권장)
git push origin main
```
`--force`로 main 이력을 갈아엎지 않는다. 다른 사람의 로컬이 깨진다.

---

## 3. Cron — 목표 스냅샷

매일 **KST 00:10**(UTC 15:10)에 목표 진척을 하루치 적립한다. 월간 보고의 과거 달 수치가 여기서 나온다.

- 설정: `vercel.json` → `crons` → `/api/cron/goal-snapshot`, `10 15 * * *`
- 인증: `CRON_SECRET`이 있으면 `Authorization: Bearer <값>`만 인정한다. 없으면 Vercel 내부 호출만.

### 잘 돌고 있는지 확인

```sql
-- 최근 실행 이력 (성공 여부·소요시간·오류)
SELECT run_date, source, ok, goal_count, duration_ms, error
  FROM snapshot_run ORDER BY id DESC LIMIT 7;

-- 오늘 스냅샷이 쌓였는지
SELECT count(*) FROM goal_snapshot WHERE snapshot_date = current_date;
```

- 화면에서는 **설정** 화면의 스냅샷 카드에서도 마지막 실행 상태를 볼 수 있다.
- **2회 연속 실패하면** 팀장에게 시스템 알림이 간다.

### 수동 실행

설정 화면의 `지금 스냅샷 만들기` 버튼. 또는:
```bash
curl -X POST https://<도메인>/api/cron/goal-snapshot \
  -H "Authorization: Bearer $CRON_SECRET"
```

**과거 달을 소급 생성하지 않는다.** 없는 날은 없는 대로 둔다 — 리포트에 `기록 없음`으로 표시된다.
지어낸 숫자를 남기지 않기 위한 규칙이다.

---

## 4. 장애 1차 대응

### A. 5분 점검 (증상 무관하게 먼저)

1. **Vercel 배포 상태** — 최근 배포가 Error면 §2 롤백.
2. **DB 살아있는가**
   ```sql
   SELECT 1;
   ```
   실패하면 DB 콘솔에서 인스턴스 상태·연결 수를 본다.
3. **Vercel Functions 로그** — 대시보드 → Logs. 5xx가 몰리는 경로를 찾는다.
4. **오류 번호** — 사용자가 500 화면의 `오류 번호`를 알려주면 로그에서 그 digest로 검색한다.

### B. 증상별

| 증상 | 원인 후보 | 대응 |
|------|-----------|------|
| 전 화면 500 | DB 연결 불가 / `DATABASE_URL` 오설정 | 환경변수 확인 → DB 상태 확인 |
| 로그인만 실패 | `AUTH_SECRET` 변경 | 값을 되돌리거나, 전원 재로그인 안내 |
| 특정 화면만 500 | 그 화면의 쿼리·마이그레이션 | 오류 번호로 로그 확인 → 코드 롤백 |
| 목표 달성률이 `-` | 프로젝트가 목표에 연결되지 않음 | 목표 화면에서 프로젝트 연결. **버그가 아니다** |
| 과거 달 리포트가 `기록 없음` | 그날 스냅샷이 없음 | 정상. 소급 생성하지 않는다 |
| Notion 카드가 안내 문구 | `NOTION_TOKEN` 미설정/권한 없음 | 설정 화면 → 연결 테스트 |
| 이미지 업로드 비활성 | `BLOB_READ_WRITE_TOKEN` 미설정 | Vercel Blob 스토어 연결 |

### C. 하면 안 되는 것

- 운영 DB에 직접 `DELETE`/`UPDATE`를 치기 전에 **반드시 백업 시점을 확인**한다.
- `AUTH_SECRET`을 장애 중에 바꾸지 않는다 — 전원 로그아웃되어 상황이 더 나빠진다.
- 마이그레이션 파일을 **이미 배포된 뒤에 수정**하지 않는다. 새 번호로 추가한다.

---

## 5. 백업 · 복구

> ⚠️ **확인 필요** — 이 항목은 개발 환경에서 검증할 수 없었다.
> 개발 환경은 로컬 Postgres(`127.0.0.1:5432`)를 쓰고, 운영 DB 콘솔에 접근할 수단이 없다.
> **팀장이 운영 DB 콘솔에서 아래를 직접 확인하고 이 문서를 채워야 한다.**

확인할 항목:

1. **자동 백업(PITR)이 켜져 있는가**, 보존 기간은 며칠인가
   - Neon: Branches → 해당 브랜치 → *History retention*
   - 무료 플랜은 보존 기간이 짧다. 팀 오픈 전에 유료 플랜의 보존 기간을 확인할 것.
2. **복구를 실제로 한 번 해봤는가** — 복구 브랜치를 만들어 데이터가 살아나는지 확인.
   해본 적 없는 백업은 백업이 아니다.
3. **복구 절차와 소요 시간**을 여기에 적어둔다.

수동 덤프(어떤 경우든 권장):
```bash
pg_dump "$DATABASE_URL" -Fc -f mission-deck-$(date +%Y%m%d).dump   # 받기
pg_restore -d "$DATABASE_URL" --clean --if-exists mission-deck-YYYYMMDD.dump   # 되돌리기
```

사고 시 순서: **① 쓰기 중단(배포 롤백 또는 점검 안내) → ② 백업 시점 확인 → ③ 복구 → ④ 검증 → ⑤ 재개**

---

## 6. 계정 운영

- 신규 팀원: **구성원 관리** 화면에서 추가. 임시 비밀번호가 발급되고 첫 로그인 때 변경을 요구한다.
- 퇴사·이동: 계정을 **지우지 말고 비활성**으로 둔다. 작성한 업무·결정 기록이 함께 사라진다.
- 권한은 `lead` / `member` 두 가지다. 관리 화면(구성원·설정·업무 현황)은 `lead` 전용이며,
  URL로 직접 들어가도 막힌다(MD-P-2026-015 §C에서 26건 전수 확인).

---

## 7. 정기 점검 (월 1회 권장)

```sql
-- 담당자 없는 진행 업무
SELECT id, title FROM task
 WHERE assignee_id IS NULL AND is_active AND status NOT IN ('done','dropped');

-- 기간이 뒤집힌 항목
SELECT id, title FROM task WHERE due_date < start_date AND is_active;

-- 목표에 연결되지 않은 프로젝트 (달성률이 안 잡힌다)
SELECT p.id, p.name FROM project p
 WHERE p.goal_id IS NULL AND p.is_active AND p.archived_at IS NULL;

-- 스냅샷 빠진 날
SELECT d::date FROM generate_series(current_date - 30, current_date, '1 day') d
 WHERE NOT EXISTS (SELECT 1 FROM goal_snapshot WHERE snapshot_date = d::date);
```

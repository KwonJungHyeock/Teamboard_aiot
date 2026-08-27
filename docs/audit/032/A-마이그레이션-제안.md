# MD-P-2026-032 §A — 마이그레이션 SQL (실행 전 제출)

**아직 실행하지 않았다.** `db/migrations/` 에도 넣지 않았다 —
그 폴더에 넣는 순간 서버가 다음 DB 접근에서 자동 적용한다(D-032).
승인 후 번호를 붙여 옮긴다.

절차는 §0 sort_order 정규화와 같다 — ① 읽기 확인 → ② 스냅샷 → ③ 실행 → ④ 사후 확인.
**배치 셋을 각각 다른 커밋으로 나눈다.** 되돌릴 때 어디까지 되돌리면 되는지가 보이도록.

---

## ① 읽기 확인 (완료 · 2026-08-27 로컬)

| 확인한 것 | 값 |
| --- | --- |
| `project` 행 | 3개 (EDUINO AI · Playino · AI 학습추론모델) — **전부 `area_id = 2`(플랫폼)** |
| `project.goal_id` | 3개 전부 NULL |
| `project.type` | **없음** (이번에 추가) |
| `area` 행 | 7개 — 활성 workspace 5 · `교육자료`는 `link_only` · `기타`는 `is_active = false` |
| 프로젝트 없는 활성 업무 | **19건** (지시서 20건과 1건 차이 — 로컬 시드 기준) |
| `trg_task_area_match` | `task.area_id` 와 `project.area_id` 일치 강제 (확인함) |
| `task.project_id` | NULL 허용 — **이번에 NOT NULL 로 바꾸지 않는다** (B-25) |

---

## 배치 ① — `project.type` 추가

```sql
-- MD-P-2026-032 §A1 — 프로젝트 종류.
--
--   goal      목표에 연결되는 프로젝트. 성과 집계에 든다.
--   standing  상시·기타. **목표 없음이 정상 상태다.**
--             「목표에 연결되지 않았습니다」 안내에서 제외한다.
--
-- 기본값을 'goal' 로 두는 이유 — 지금 있는 셋은 전부 목표에 붙을 프로젝트다.
-- 새로 만드는 상시 프로젝트만 배치 ②에서 'standing' 으로 넣는다.
--
-- 비파괴다: ADD COLUMN + DEFAULT + CHECK 뿐이고 기존 행의 값을 바꾸지 않는다.
ALTER TABLE project
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'goal';

-- CHECK 는 별도 문장으로 — 이미 있으면 건너뛴다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_type_check') THEN
    ALTER TABLE project ADD CONSTRAINT project_type_check
      CHECK (type IN ('goal', 'standing'));
  END IF;
END $$;

-- §A4 — 상시 프로젝트는 목표를 갖지 않는다. **서버 코드가 아니라 여기서 막는다.**
-- 코드에서만 막으면 경로가 늘 때마다 한 곳을 빠뜨린다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_standing_no_goal') THEN
    ALTER TABLE project ADD CONSTRAINT project_standing_no_goal
      CHECK (type <> 'standing' OR goal_id IS NULL);
  END IF;
END $$;
```

**사후 확인 (④)**

```sql
SELECT type, count(*) FROM project GROUP BY type;              -- goal 3 · standing 0
SELECT conname FROM pg_constraint
 WHERE conrelid = 'project'::regclass AND conname LIKE 'project_%check%'
    OR conname = 'project_standing_no_goal';
```

**되돌리기**

```sql
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_standing_no_goal;
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_type_check;
ALTER TABLE project DROP COLUMN IF EXISTS type;
```

---

## 배치 ② — 상시 프로젝트

> **판단이 필요하다. 이 배치는 승인 없이 실행하지 않는다.**

지시서는 「활성 영역 수만큼 — 지금 일곱 개」라고 적었는데 **로컬과 맞지 않는다.**

| | 개수 | 영역 |
| --- | --- | --- |
| 전체 영역 행 | 7 | R&D · 플랫폼 · 교육자료 · 디자인 · 연구소 · 현장실습교육 · 기타 |
| 활성 | 6 | 위에서 `기타` 제외 (`is_active = false`) |
| **활성 + workspace** | **5** | R&D · 플랫폼 · 디자인 · 연구소 · 현장실습교육 |
| 프로젝트 없는 업무가 남아 있는 영역 | **7** | 전부 |

`교육자료`(link_only, 1건)와 `기타`(비활성, 3건)에 **업무 4건이 살아 있다.**
다섯 개만 만들면 그 4건은 갈 곳이 없다.

**세 갈래. PM 이 고른다.**

- **ⓐ 일곱 개 전부 만든다** — 업무가 있는 곳에는 담을 그릇을 둔다.
  대신 `link_only`·비활성 영역에 프로젝트가 생긴다. 「작업 공간이 없는 영역」이라는
  파트 0 규정과 부딪힌다.
- **ⓑ 다섯 개만 만들고, 나머지 4건은 영역을 옮긴다** — 예컨대 `[기타]` 3건을
  `플랫폼`(팀보드 제작이므로) 으로, `[교육자료]` 1건을 `플랫폼` 으로.
  **업무의 영역을 바꾸는 것이라 별도 판단이다.**
- **ⓒ 다섯 개 + 예외 둘** — 만들되 `기타`·`교육자료`의 상시 프로젝트는
  `is_active = false` 로 두고 목록에 안 보이게 한다. 업무는 담기지만 새 업무는 못 붙는다.

아래 SQL 은 **ⓐ 기준**이다. 다른 갈래를 고르시면 그에 맞춰 다시 낸다.

```sql
-- MD-P-2026-032 §A2 — 영역별 상시 프로젝트.
--
-- **하나로 통합할 수 없다.** `task.area_id` 가 NOT NULL 이고
-- `trg_task_area_match` 가 프로젝트와 업무의 영역 일치를 강제한다 —
-- 상시 프로젝트가 하나면 한 영역 업무만 담는다.
--
-- 이름은 `상시 · <영역>`. 색은 영역 색을 따라간다(없으면 team).
-- 이미 있으면 안 만든다 — 두 번 돌려도 안전하다.
INSERT INTO project (name, status, color_key, area_id, type, is_active)
SELECT '상시 · ' || a.name, 'active', COALESCE(a.color_key, 'team'), a.id, 'standing', true
  FROM area a
 WHERE NOT EXISTS (
         SELECT 1 FROM project p WHERE p.area_id = a.id AND p.type = 'standing'
       );
```

**사후 확인 (④)**

```sql
SELECT p.id, p.name, p.type, a.name AS area, p.is_active
  FROM project p JOIN area a ON a.id = p.area_id
 WHERE p.type = 'standing' ORDER BY a.sort_order, a.id;
-- 기대: 7행 · 전부 type='standing' · goal_id IS NULL
SELECT count(*) FROM project WHERE type = 'standing' AND goal_id IS NOT NULL;  -- 0
```

**되돌리기**

```sql
-- 업무를 아직 안 옮겼을 때만 안전하다(배치 ③ 전).
DELETE FROM project WHERE type = 'standing' AND NOT EXISTS (
  SELECT 1 FROM task t WHERE t.project_id = project.id
);
```

---

## 실행 전 검증 — **롤백 트랜잭션으로 미리 굴렸다**

「실행 전에 제출한다」를 지키면서도 **SQL 이 도는지는 확인할 수 있다.**
`BEGIN … ROLLBACK` 안에서 배치 ①②를 통째로 돌리고 결과만 읽었다.
문법·제약·결과 건수를 다 확인하고 **아무것도 남기지 않는다.**

```
ALTER TABLE / DO / DO          — 컬럼·CHECK 둘 다 통과
type  | count                  — goal 3 (기존 셋이 전부 goal 로 들어간다)
INSERT 0 7                     — 상시 프로젝트 7행
상시생성 7 · 상시인데목표있음 0   — CHECK 가 서 있다
ROLLBACK
```

되돌린 뒤 확인 — `project.type` 컬럼 **0개**, `project` 행 **3개**(그대로).
즉 이 문서를 쓴 시점에 DB 는 **손대지 않은 상태**다.

> **제출 전에 롤백 트랜잭션으로 한 번 굴린다.**
> 「돌 것 같다」와 「돌았다」는 다르다. 승인받은 SQL 이 승인 뒤에 실패하면
> 그 실패는 스냅샷과 실행 사이에 끼어 가장 나쁜 자리에 놓인다.

---

## 배치 ③ — 업무 귀속

**A3 목록(`docs/audit/032/A3-귀속대상.md`) 확인 후에 낸다.**
PM 이 「이건 EDUINO AI 로」라고 지정한 것을 반영해야 SQL 이 확정된다.

미리 알려 둘 것 — **추정 프로젝트로 옮기려면 업무의 영역도 함께 바뀌는 경우가 있다.**
`trg_task_area_match` 때문이다. 해당 6건은 A3 표의 「비고」에 적어 두었다.

`task.project_id` 는 **NOT NULL 로 만들지 않는다** — 경로 하나가 빠졌을 때
500 이 나느니 프로젝트 없이 남는 편이 낫다. 한 달 뒤 별도 판단(**B-25**).

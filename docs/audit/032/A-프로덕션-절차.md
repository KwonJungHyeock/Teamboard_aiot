# MD-P-2026-032 §A — 프로덕션 절차 (PM 이 Neon 에서 실행)

`0029` · `0030` · `0031` 이 `db/migrations/` 에 있다.
**`main` 에 올라가면 서버가 다음 DB 접근에서 자동 적용한다**(D-032).
§0 sort_order 때처럼 「실행 전에 스냅샷을 뜨는 틈」이 **없다.**

그래서 순서가 이렇다.

    0-1 스냅샷 (병합 전)  →  병합  →  0-2 사후 확인  →  (필요시) 0-3 되돌리기

---

## 0-1. 병합 **전** — 스냅샷

전부 **읽기 전용**이다. 아무것도 바꾸지 않는다. 결과를 보관해 두었다가 0-2 와 대조한다.

### ① `project` 전량

```sql
SELECT id, name, area_id, goal_id, is_active
  FROM project
 ORDER BY id;
```

> 보관할 것 — **행 수**와 **id 목록**. 0-2 에서 「원래 있던 것이 안 바뀌었는가」를 본다.

### ② 프로젝트 없는 활성 업무 전량

```sql
SELECT id, title, area_id
  FROM task
 WHERE is_active = true AND project_id IS NULL
 ORDER BY area_id, id;
```

> 보관할 것 — **행 수**, **id 목록**, 그리고 **영역별 분포**.
> 영역 분포가 0-2 에서 **똑같아야** 한다. 그것이 「영역을 안 바꿨다」의 증명이다.
> 건수만 맞추면 증명이 안 된다.

영역 분포를 한 줄로 뽑으려면:

```sql
SELECT area_id, count(*)
  FROM task
 WHERE is_active = true AND project_id IS NULL
 GROUP BY area_id ORDER BY area_id;
```

### ③ 영역 상태 — **B-26 조회를 겸한다**

```sql
SELECT a.id, a.name, a.kind, a.is_active,
       count(t.id) FILTER (WHERE t.is_active) AS 활성업무
  FROM area a
  LEFT JOIN task t ON t.area_id = a.id
 GROUP BY a.id, a.name, a.kind, a.is_active, a.sort_order
 ORDER BY a.sort_order, a.id;
```

> 이 표가 **상시 프로젝트가 몇 개 만들어질지**를 미리 말해 준다 —
> `활성업무 > 0` 인 행 수가 곧 그 개수다.
>
> 그리고 B-26 의 재료이기도 하다. 로컬에서는 `교육자료`가 `link_only` 이고
> `기타`가 `is_active = false` 인데 둘 다 업무가 살아 있었다.
> **프로덕션에서도 그런지 이 표로 확인한다.**

### 참고 — 목표 연결도 함께 떠 두면 좋다

```sql
SELECT count(*) FROM goal_task;
```

> 0-2 에서 **before == after** 를 본다. §A 는 목표 연결을 건드리지 않는다.

---

## 0-2. 병합 **후** — 사후 확인

로컬에서 돌린 것과 **같은 SQL** 이다. 판정 기준을 옆에 적었다.

| # | 쿼리 | 통과 기준 |
| --- | --- | --- |
| 1 | `SELECT type, count(*) FROM project GROUP BY type;` | `goal` · `standing` **두 값뿐**. 다른 값이 있으면 실패 |
| 2 | 아래 「영역 덮음」 | 두 수가 **같다** |
| 3 | `SELECT count(*) FROM task WHERE is_active AND project_id IS NULL;` | **0** |
| 4 | 아래 「영역 일치」 | **0** |
| 5 | `SELECT count(*) FROM goal_task;` | 0-1 참고값과 **같다** |
| 6 | `SELECT count(*) FROM project WHERE type='standing' AND goal_id IS NOT NULL;` | **0** |

**2. 영역 덮음** — 활성 업무가 있는 영역이 전부 상시 프로젝트를 가졌는가.

```sql
SELECT
  (SELECT count(*) FROM area a
    WHERE EXISTS (SELECT 1 FROM task t WHERE t.area_id = a.id AND t.is_active)) AS 업무있는영역,
  (SELECT count(*) FROM area a
    WHERE EXISTS (SELECT 1 FROM task t WHERE t.area_id = a.id AND t.is_active)
      AND EXISTS (SELECT 1 FROM project p WHERE p.area_id = a.id AND p.type = 'standing')) AS 상시있는영역;
```

**4. 영역 일치** — 업무의 영역과 프로젝트의 영역이 어긋난 행이 없는가.

```sql
SELECT count(*)
  FROM task t JOIN project p ON p.id = t.project_id
 WHERE t.is_active AND t.area_id <> p.area_id;
```

**영역 분포 대조** — 0-1 ②에서 뜬 분포와 같은지 본다. 이것이 핵심이다.

```sql
SELECT t.area_id, count(*)
  FROM task t JOIN project p ON p.id = t.project_id
 WHERE p.type = 'standing'
 GROUP BY t.area_id ORDER BY t.area_id;
```

> **0-1 ②의 분포와 한 줄도 다르면 안 된다.**
> 다르면 어딘가에서 영역이 바뀐 것이고, 그건 이 마이그레이션이 하지 않기로 한 일이다.

### 만들어진 상시 프로젝트 확인

```sql
SELECT p.id, p.name, p.type, a.name AS 영역, a.kind, a.is_active AS 영역활성
  FROM project p JOIN area a ON a.id = p.area_id
 WHERE p.type = 'standing'
 ORDER BY a.sort_order, a.id;
```

> **개수를 미리 적지 않는다.** 0-1 ③에서 `활성업무 > 0` 이던 영역 수와 같으면 통과다.
> 로컬에서는 7개였다 — 그 숫자를 프로덕션에 기대하지 않는다.

---

## 0-3. 되돌리기

`db/migrations/rollback/0029_0031_project_type_standing_down.sql`

**자동 적용이라 「실행하지 않기」로는 되돌릴 수 없다.** SQL 이 있어야 한다.

- 세 단계를 **역순으로** 한 파일에 담았다 — ③ 업무 귀속 → ② 상시 프로젝트 → ① 컬럼.
- 어디까지 되돌릴지 골라서 그 부분만 돌린다.
- `schema_migrations` 에서 줄을 **지우지 않는다**(RUNBOOK 규약). 다시 적용해야 하면
  **새 번호로 정방향 마이그레이션을 쓴다.**

> ⚠ **③은 시간이 지날수록 위험해진다.**
> 배치 ③ 직후에는 「상시에 붙은 업무」가 마이그레이션이 붙인 것뿐이다.
> 그 뒤 사람이 화면에서 붙인 것이 섞이면 그대로 돌릴 때 **사람이 한 일까지 지운다.**
> 파일 안에 「되돌리기 전에 몇 건이 떨어지는지 먼저 세는」 쿼리를 적어 뒀다.

코드만 되돌리면 되는 경우는 Vercel Promote 로 30초다(RUNBOOK). 스키마는 위 순서다.

---

## 로컬 실행 결과 (대조용)

프로덕션과 다를 수 있다. **숫자를 기대값으로 쓰지 말고 형태만 본다.**

| | 값 |
| --- | --- |
| 배치 ① `type` | `goal` 3 · `standing` 0 → 기존 3행 값 그대로 |
| 제약 | `type='zzz'` · `standing + goal_id` **둘 다 실제로 거부됨** |
| 배치 ② 상시 프로젝트 | **7개** (규칙이 센 수) · 재실행 `INSERT 0 0` |
| 배치 ③ 전 | 프로젝트 없는 활성 업무 **19건** · 분포 `1:5 2:3 3:1 4:3 5:3 6:1 7:3` |
| 배치 ③ 후 | **0건** · 분포 `1:5 2:3 3:1 4:3 5:3 6:1 7:3` (**동일**) |
| 영역 ≠ 프로젝트 영역 | 0 |
| `goal_task` | 14 → 14 |

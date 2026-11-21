-- 운영 전략 (2026-11-21, 지시서 v1): 새 표 셋: 전략 항목 · 변경 이력 · 의견. 기존 표는 건드리지 않는다.
--
--   strategy_item     축 × 단계 칸에 놓이는 항목. 현재 기준 · 담당 · 상태 · 잠금 · 최근 변경일
--                     폐기는 status = 'dropped' (소프트삭제, 되살릴 수 있다)
--                     link_url 은 지표 축의 「집계 화면 링크」 칸(숫자 칸은 두지 않는다)
--   strategy_change   현재 기준이 바뀐 기록. 잠긴 항목을 팀원이 고치면 pending 으로만 남고 기준은 그대로
--   strategy_comment  의견
--
-- 낱말(축 · 단계 · 상태 · 승인 상태)은 lib/strategy-words.ts 가 한 곳이다. 아래 CHECK 와 같아야 한다.
-- 팀 칸(team_id)은 0036 · 0042 규칙대로 단다(DEFAULT 는 aiot 팀 id 를 찾아 건다).
-- 되돌리기: db/migrations/rollback/0051_strategy_down.sql

CREATE TABLE IF NOT EXISTS strategy_item (
  id          SERIAL PRIMARY KEY,
  axis        TEXT NOT NULL CHECK (axis IN ('inflow', 'sales', 'content', 'metric')),
  phase       SMALLINT NOT NULL CHECK (phase IN (1, 2)),
  title       TEXT NOT NULL,
  standard    TEXT NOT NULL DEFAULT '',
  owner_id    INTEGER REFERENCES actor(id),
  status      TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('live', 'review', 'dropped')),
  locked      BOOLEAN NOT NULL DEFAULT false,
  link_url    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES actor(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_strategy_item_cell ON strategy_item (axis, phase, sort_order, id);

CREATE TABLE IF NOT EXISTS strategy_change (
  id               SERIAL PRIMARY KEY,
  item_id          INTEGER NOT NULL REFERENCES strategy_item(id),
  before_text      TEXT NOT NULL DEFAULT '',
  after_text       TEXT NOT NULL,
  reason           TEXT,
  meeting_id       INTEGER REFERENCES meeting(id),
  meeting_item_id  INTEGER REFERENCES meeting_item(id),
  changed_by       INTEGER REFERENCES actor(id),
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approval         TEXT NOT NULL CHECK (approval IN ('direct', 'pending', 'approved', 'rejected')),
  decided_by       INTEGER REFERENCES actor(id),
  decided_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_strategy_change_item ON strategy_change (item_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_change_pending ON strategy_change (item_id) WHERE approval = 'pending';

CREATE TABLE IF NOT EXISTS strategy_comment (
  id          SERIAL PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES strategy_item(id),
  author_id   INTEGER NOT NULL REFERENCES actor(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_strategy_comment_item ON strategy_comment (item_id, created_at);

DO $$
DECLARE
  t INTEGER;
  tb TEXT;
BEGIN
  SELECT id INTO t FROM team WHERE key = 'aiot';
  IF t IS NULL THEN
    RAISE EXCEPTION '0051: team.key = aiot 행이 없다 (0036 이 덜 돌았다)';
  END IF;
  FOREACH tb IN ARRAY ARRAY['strategy_item', 'strategy_change', 'strategy_comment'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES team(id)', tb);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN team_id SET DEFAULT %s', tb, t);
    EXECUTE format('UPDATE %I SET team_id = %s WHERE team_id IS NULL', tb, t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN team_id SET NOT NULL', tb);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (team_id)', 'idx_' || tb || '_team', tb);
  END LOOP;

  -- ── 초기값 (지시서 파트 5): 표가 비어 있을 때만. 담당은 비워 두고 팀장이 지정한다 ──
  -- 항목명 · 현재 기준은 첫 콜론으로 나눈다. 콜론이 없거나 괄호 안에만 있으면 한 줄을 둘 다에 넣는다.
  IF NOT EXISTS (SELECT 1 FROM strategy_item WHERE team_id = t) THEN
    INSERT INTO strategy_item (team_id, axis, phase, title, standard, status, locked, sort_order) VALUES
      (t, 'inflow', 1, '3D 조립서 무료 공개로 가입 유도', '3D 조립서 무료 공개로 가입 유도', 'live', false, 1),
      (t, 'inflow', 1, '12월 연말 교구 예산 대상 키트+콘텐츠 묶음 판매', '12월 연말 교구 예산 대상 키트+콘텐츠 묶음 판매', 'live', false, 2),
      (t, 'inflow', 1, '1~2월 방학 교사 연수 · 체험단 운영', '1~2월 방학 교사 연수 · 체험단 운영', 'review', false, 3),
      (t, 'inflow', 2, '학기 일정 운영', '3월 신학기 판매, 4~6월 사례 수집, 7~8월 연수 · 신규 콘텐츠, 11~12월 교구 예산', 'review', false, 1),
      (t, 'sales', 1, '구매는 경로 ①(플랫폼 가입 후 구매)만 운영', '구매는 경로 ①(플랫폼 가입 후 구매)만 운영', 'live', true, 1),
      (t, 'sales', 1, '가격', '1개월 5천 원 기준, 6개월 30% · 12개월 50% 할인 표기', 'live', true, 2),
      (t, 'sales', 1, '활성화 문의', 'FAQ 한 장 + 문의 창구 하나, 영업일 1일 응답', 'review', false, 3),
      (t, 'sales', 2, '경로 ②(자사몰 바로 구매 + 등록 링크) 전환, 전환 기준 미정', '경로 ②(자사몰 바로 구매 + 등록 링크) 전환, 전환 기준 미정', 'review', false, 1),
      (t, 'sales', 2, '학교 단위 견적 · 후불 결제', '학교 단위 견적 · 후불 결제', 'review', false, 2),
      (t, 'sales', 2, '가격 인상', '1,000명 초과 시 신규 구매에만 적용, 30일 전 공지', 'review', true, 3),
      (t, 'content', 1, '신규 키트 없이 출시 키트 3종 개선, 2주 단위 수정', '신규 키트 없이 출시 키트 3종 개선, 2주 단위 수정', 'live', false, 1),
      (t, 'content', 1, '무료 콘텐츠 1개 운영 여부', '무료 콘텐츠 1개 운영 여부', 'review', false, 2),
      (t, 'content', 2, '분기마다 키트 1종 추가, 순서는 1단계 데이터로 결정 (후보: 스마트팜 → 스마트팩토리 → 로봇공학 02)', '분기마다 키트 1종 추가, 순서는 1단계 데이터로 결정 (후보: 스마트팜 → 스마트팩토리 → 로봇공학 02)', 'review', false, 1),
      (t, 'metric', 1, '핵심 지표', '주간 수업 사용 반 수, 키트 동반 구매율', 'review', false, 1),
      (t, 'metric', 1, '주간 집계', '조립서 방문 → 가입 → 구매·활성화 → 반 생성 → 학생 입장 → 키트 구매', 'review', false, 2),
      (t, 'metric', 1, '1~2월 방학 사용량 감소 감안, 비교 기준은 12월 첫 3주', '1~2월 방학 사용량 감소 감안, 비교 기준은 12월 첫 3주', 'live', false, 3),
      (t, 'metric', 2, '월간 보고, 가격 조정 · 콘텐츠 양산 기준에 반영', '월간 보고, 가격 조정 · 콘텐츠 양산 기준에 반영', 'review', false, 1);
  END IF;
END $$;

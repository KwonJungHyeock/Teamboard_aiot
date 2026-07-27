-- 업무 진행률(수동, 0~100) + 샘플 목표 제거.
-- 진행률: task.progress. 완료 업무는 100으로 초기화(상태-진행률 정합). 나머지는 0(수동 지정).
-- 프로젝트 진척도·목표(auto)는 이 값의 평균으로 재계산된다(코드 측).
ALTER TABLE task ADD COLUMN IF NOT EXISTS progress SMALLINT NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_progress_range') THEN
    ALTER TABLE task ADD CONSTRAINT task_progress_range CHECK (progress BETWEEN 0 AND 100);
  END IF;
END $$;

-- 완료 업무 진행률 100 정합 (기존/이관 데이터)
UPDATE task SET progress = 100 WHERE status = 'done' AND progress <> 100;

-- 샘플/고정 예시 목표 전량 보관(소프트삭제) — 사용자가 직접 생성·연결하도록 초기화.
-- goal_task 링크는 유지(구조 보존). 하드삭제 없음.
UPDATE goal SET is_active = false WHERE is_active = true;

-- 실제 업무 이관 — 데모 샘플 → 실데이터(24건). 하드삭제 금지(is_active=false만).
-- 선행: 영역 구조 조정(교육자료=업무 수용, 기타 재활성) → 샘플 소프트삭제 → CSV 24건 삽입.
-- 목표·프로젝트·영역·signal 구조 유지. 목표 집계는 live 계산이라 자동 재반영.
-- LLM 수치생성 없음 — 모든 값은 CSV 그대로.

-- ── 1. 영역 구조 조정 (선행) ──
-- 교육자료: link_only → workspace (링크 유지 + 업무 수용)
UPDATE area SET kind = 'workspace' WHERE name = '교육자료';
-- 기타: 재활성 (업무 수용 영역 신설)
UPDATE area SET is_active = true, kind = 'workspace' WHERE name = '기타';

-- ── 2. 샘플 전량 소프트삭제 (하드삭제 금지) ──
-- 샘플 업무 전량
UPDATE task SET is_active = false, updated_at = now() WHERE is_active = true;
-- 리뷰세션 테스트("결정: 홈")·[임시] 잔재 (signal 구조 자체는 유지)
UPDATE signal SET is_active = false
WHERE is_active = true AND (title = '결정: 홈' OR title LIKE '[임시]%');

-- ── 3. CSV import (24건) ──
-- 담당자 세미콜론 다중 → 첫째=담당(assignee), 나머지는 메모 "협업:"에 병기(단일 assignee 스키마).
-- 프로젝트 빈칸 → 영역 직속(project_id NULL). 종료일=기한(due_date). 완료건 completed_at=기한(없으면 시작일) 12:00 KST.
INSERT INTO task (title, area_id, project_id, assignee_id, created_by, status, priority, start_date, due_date, completed_at, description, origin, is_active)
SELECT v.title, ar.id, pr.id, asg.id, asg.id, v.status, v.priority, v.start_date, v.due_date,
       CASE WHEN v.status = 'done'
            THEN (COALESCE(v.due_date, v.start_date)::text || ' 12:00:00+09')::timestamptz
            END,
       v.description, 'human', true
FROM (VALUES
  ('[플랫폼] 외부 1차 PoC', '플랫폼', 'EDUINO AI', '권정혁', 'done', 'high', DATE '2026-07-02', DATE '2026-07-16', E'협업: 조서연, 박주희'),
  ('[플랫폼] ESP32-CAM 보드 통신검증', '플랫폼', 'EDUINO AI', '권정혁', 'done', 'high', DATE '2026-07-06', DATE '2026-07-08', E'수업용 보드 wifi 통신상태 점검 및 재고준비 /20EA'),
  ('[플랫폼] ESP32-CAM 보드 통시접속 통신검증', '플랫폼', 'EDUINO AI', '권정혁', 'done', 'mid', DATE '2026-07-13', DATE '2026-07-13', E''),
  ('[플랫폼] 관리자 페이지 기획', '플랫폼', 'EDUINO AI', '권정혁', 'todo', 'mid', NULL::date, NULL::date, E'플랫폼 관리자 페이지 기획 및 제작\n\n협업: 조서연, 박주희'),
  ('[R&D] 특허 관련 연구개발 요약서 및 사업계획서 준비', 'R&D', '', '권정혁', 'todo', 'low', NULL::date, DATE '2026-07-29', E'특허 출원 관련 연구개발 요약서 작성'),
  ('[플랫폼] Playino 미니게임천국 피드백 반영 및 MVP용 제작', '플랫폼', 'Playino', '권정혁', 'todo', 'high', NULL::date, DATE '2026-07-30', E'플랫폼 내 이식 가능 검토 확인'),
  ('[현장실습] 하계 현장실습 진행', '현장실습교육', '', '권정혁', 'doing', 'mid', DATE '2026-06-25', DATE '2026-08-24', E'협업: 박주희, 조서연'),
  ('[연구소] 회사 소개서 최신화', '연구소', '', '권정혁', 'todo', 'low', NULL::date, DATE '2026-07-31', E'기존 회사 소개서 양식 최신화'),
  ('[플랫폼] 플랫폼 구조 개선', '플랫폼', 'EDUINO AI', '조서연', 'doing', 'high', DATE '2026-07-08', DATE '2026-07-14', E'1차 피드백 및 외부 PoC 기능에 필요한 구조 개선작업 진행'),
  ('[플랫폼] 내부 1차 PoC', '플랫폼', 'EDUINO AI', '권정혁', 'todo', 'high', NULL::date, DATE '2026-07-08', E'현장실습생 2명 대상 플랫폼 1차 테스트 진행'),
  ('[플랫폼] Playino 신제품 구성품리스트 작성', '플랫폼', 'Playino', '권정혁', 'todo', 'mid', NULL::date, DATE '2026-07-08', E'중국발주용 신제품 구성품리스트 전달'),
  ('[플랫폼] 플랫폼 교육자료 제작', '플랫폼', 'EDUINO AI', '박주희', 'done', 'high', DATE '2026-07-02', DATE '2026-07-10', E'esp32 ai 2휠 rc카 제작 / esp32-cam-rccar: https://app.notion.com/p/esp32-cam-rccar-2b171ecddc8383ed93bd01ca544173ed'),
  ('[R&D] 연구개발 1차 구매 부품리스트 작성', 'R&D', '', '권정혁', 'todo', 'low', NULL::date, DATE '2026-07-13', E''),
  ('[R&D] 기술이전 동의서 송부', 'R&D', '', '권정혁', 'done', 'high', DATE '2026-07-03', DATE '2026-07-03', E'기술이전 동의서 및 법인 인감 사본 전달'),
  ('[교육자료] Appinventor 설치파트 삽입', '교육자료', '', '권정혁', 'done', 'mid', DATE '2026-07-13', DATE '2026-07-13', E'기술문의를 통해 교육자료 일부 개선내용'),
  ('[기타] 에듀이노 통합 업무관리 프로그램', '기타', '', '권정혁', 'doing', 'low', DATE '2026-07-06', NULL::date, E''),
  ('[플랫폼] 도메인 이전', '플랫폼', 'EDUINO AI', '조서연', 'done', 'mid', DATE '2026-07-07', DATE '2026-07-08', E''),
  ('[플랫폼] AI 학습추론모델 Git 이관(→lab git)', '플랫폼', 'AI 학습추론모델', '권정혁', 'doing', 'mid', DATE '2026-07-08', DATE '2026-07-09', E'학습추론모델 최적화를 위해 lab git에 프로젝트 이관 및 교육생에게 전달\n\n협업: 조서연'),
  ('[플랫폼] 교육자료 피드백 반영', '플랫폼', 'EDUINO AI', '박주희', 'done', 'high', DATE '2026-07-13', NULL::date, E''),
  ('[플랫폼]벤치마킹', '플랫폼', 'EDUINO AI', '박주희', 'doing', 'mid', DATE '2026-07-20', DATE '2026-07-24', E''),
  ('[플랫폼] 시연 후 업무 정리', '플랫폼', 'EDUINO AI', '박주희', 'done', 'mid', DATE '2026-07-16', DATE '2026-07-16', E'협업: 조서연'),
  ('[기타] 에듀이노 팀 통합업무관리프로그램 제작', '기타', '', '권정혁', 'doing', 'high', DATE '2026-07-06', DATE '2026-07-24', E'통합업무관리프로그램 제작 및 유지보수'),
  ('[플랫폼] 플랫폼 구조 기획(피드백, 시장조사 기반) (1)', '플랫폼', 'EDUINO AI', '권정혁', 'doing', 'high', DATE '2026-07-21', DATE '2026-07-24', E'협업: 박주희, 조서연'),
  ('[기타] 한국로봇학회 온라인 강의 (1)', '기타', '', '권정혁', 'done', 'high', DATE '2026-07-22', DATE '2026-07-24', E'인공지능 로봇학회 여름학교 세미나강의')
) AS v(title, area_name, project_name, assignee_name, status, priority, start_date, due_date, description)
JOIN area ar ON ar.name = v.area_name
LEFT JOIN project pr ON pr.name = v.project_name AND v.project_name <> ''
JOIN actor asg ON asg.display_name = v.assignee_name AND asg.type = 'human';

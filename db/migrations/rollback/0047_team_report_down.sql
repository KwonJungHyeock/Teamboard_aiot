-- 롤백: 0047 팀 보고 — 보고에 쓴 글 · 에셋 연결이 모두 사라진다(업무 · 목표는 그대로).
DROP TABLE IF EXISTS team_report_plan;
DROP TABLE IF EXISTS team_report_action;
DROP TABLE IF EXISTS team_report_issue;
DROP TABLE IF EXISTS team_report_request;
DROP TABLE IF EXISTS team_report_asset;
DROP TABLE IF EXISTS team_report_item;
DROP TABLE IF EXISTS team_report;
DELETE FROM config WHERE key = 'report_part_order';

-- 롤백: 0051: 운영 전략 표 셋을 지운다(기존 표는 0051 에서 건드리지 않았다).
DROP TABLE IF EXISTS strategy_comment;
DROP TABLE IF EXISTS strategy_change;
DROP TABLE IF EXISTS strategy_item;

# MD-P-2026-031 §C 완료 — 캡처

1440×950 · 배율 100% · deviceScaleFactor 1 · 로컬 시드 데이터

- 01-home.png — 홈 — 탭 없음 · 오른쪽 레일 320px · 진행 중인 일(진척 열 유지) · 기한 막대 트랙 232px
- 02-tasks.png — 업무 목록 · 기한 막대 트랙 258px
- 03-project.png — 프로젝트 상세 「EDUINO AI」 업무 탭 · 기한 막대 트랙 302px
- 04-area.png — 영역 상세 「R&D」 (B-11 재생성) — TasksView 고정 모드 · 기한 막대 트랙 258px
- 05-status.png — 업무 현황 — 담당자 줄(평균 진척 → 진행 중·지연·이번 주·막고 있는 것)

**§C4** — 01·02·03·04 넷이 같은 `TaskTable` 로 **같은 기한 막대 목록**을 그린다.
`scripts/component-reuse-audit.mjs` 가 import·화면·두 벌 금지 세 층에서 4/4 로 확인한다.

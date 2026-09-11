#!/bin/bash
# 검사기 전량 — 한 줄씩, 결과만 모은다. 실패를 삼키지 않는다 (§G 051).
cd /home/user/Teamboard_aiot
set -a; . ./.env.local; set +a
export BASE=http://127.0.0.1:3000
OUT=/tmp/claude-0/-home-user-Teamboard-aiot/adf96df0-0e60-5e6d-9d25-2d0d7b866cbe/scratchpad/walk056
mkdir -p "$OUT"
: > "$OUT/summary.txt"
for f in scripts/*walk*.mjs; do
  n=$(basename "$f" .mjs)
  node "$f" > "$OUT/$n.log" 2>&1
  rc=$?
  last=$(grep -E "통과|실패|FAIL|failures|오류" "$OUT/$n.log" | tail -2 | tr '\n' ' ')
  printf '%-3s %-28s rc=%d  %s\n' "$([ $rc -eq 0 ] && echo OK || echo XX)" "$n" "$rc" "$last" >> "$OUT/summary.txt"
  printf '%-3s %-28s rc=%d  %s\n' "$([ $rc -eq 0 ] && echo OK || echo XX)" "$n" "$rc" "$last"
done
echo "=== done ==="

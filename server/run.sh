#!/bin/sh
# 운영 (재)시작. 운영 서버엔 systemd arena.service(Restart=always)가 있어서 프로세스를 죽이면 3초 뒤 새 코드로 다시 뜬다.
# 서비스가 없는 곳이면 직접 띄운다. 비밀값(ACCESS_KEY, ADMIN_PW)은 server.js가 같은 폴더 .env에서 읽는다.
cd "$(dirname "$0")"
OLD=$(ss -ltnp 2>/dev/null | grep ":3000 " | sed -n 's/.*pid=\([0-9]*\).*/\1/p')
[ -n "$OLD" ] && kill $OLD
sleep 6
if ! ss -ltn | grep -q ":3000 "; then
  PORT=3000 MODEL=haiku setsid nohup /usr/bin/node server.js >> arena.log 2>&1 < /dev/null &
  sleep 2
fi
ss -ltnp | grep ":3000 "

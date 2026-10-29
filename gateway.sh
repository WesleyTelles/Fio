#!/usr/bin/env bash
# Uso: scripts/gateway.sh start|stop   (gateway de teste; usa pidfile)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; PIDF=/tmp/fio-gateway.pid
case "${1:-start}" in
  stop) [ -f $PIDF ] && kill "$(cat $PIDF)" 2>/dev/null; rm -f $PIDF ;;
  start) "$0" stop; cd "$ROOT"; nohup node tools/gateway/server.mjs > /tmp/gw.log 2>&1 & echo $! > $PIDF; sleep 1.5; cat /tmp/gw.log ;;
esac

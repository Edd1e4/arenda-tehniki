#!/usr/bin/env bash
set -euo pipefail
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[ "$EUID" -eq 0 ] || fail 'Run as root.'
[ -s /etc/arenda24mo/claude.env ] && [ -s /etc/arenda24mo/telegram.env ] || fail 'Missing credential files; nothing started.'
[ -s /var/lib/arenda24mo/telegram-state.json ] || fail 'Transfer the paired Telegram state first; do not start an unpaired public bot.'
chown root:arenda24mo /etc/arenda24mo/claude.env /etc/arenda24mo/telegram.env
chmod 0640 /etc/arenda24mo/claude.env /etc/arenda24mo/telegram.env
for name in orders.json telegram-state.json; do
  if [ -f "/var/lib/arenda24mo/$name" ]; then chown arenda24mo:arenda24mo "/var/lib/arenda24mo/$name"; chmod 0600 "/var/lib/arenda24mo/$name"; fi
done
runuser -u arenda24mo -- env -i PATH=/usr/bin:/bin /usr/bin/node --env-file=/etc/arenda24mo/claude.env -e 'if(!process.env.ANTHROPIC_API_KEY||!process.env.CLAUDE_MODEL)process.exit(1)' || fail 'Claude settings incomplete.'
runuser -u arenda24mo -- env -i PATH=/usr/bin:/bin /usr/bin/node --env-file=/etc/arenda24mo/telegram.env -e 'if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(process.env.TELEGRAM_BOT_TOKEN||""))process.exit(1)' || fail 'Telegram settings incomplete.'
runuser -u arenda24mo -- /usr/bin/node -e 'const fs=require("node:fs");const s=JSON.parse(fs.readFileSync("/var/lib/arenda24mo/telegram-state.json","utf8"));if(!s.owner||!Number.isSafeInteger(s.owner.chatId)||!Number.isSafeInteger(s.owner.userId))process.exit(1)' || fail 'Paired chat state invalid.'
printf '%s\n' 'The local Windows bot must be stopped before enabling the Telegram service.'
systemctl daemon-reload
systemctl enable --now arenda24mo-dispatcher.service
ready=false
for attempt in 1 2 3 4 5; do
  if curl -fsS --max-time 3 http://127.0.0.1:4388/ >/dev/null; then ready=true; break; fi
  sleep 2
done
[ "$ready" = true ] || fail 'Dispatcher did not become ready; Telegram was not started.'
systemctl enable --now arenda24mo-telegram.service
sleep 3
systemctl is-active --quiet arenda24mo-dispatcher.service || fail 'Dispatcher not active.'
systemctl is-active --quiet arenda24mo-telegram.service || fail 'Telegram not active.'
printf '%s\n' 'SERVICES_ACTIVE. Verify a message from the paired private Telegram chat and confirm journal persistence.'

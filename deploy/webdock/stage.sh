#!/usr/bin/env bash
set -euo pipefail
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[ "$EUID" -eq 0 ] || fail 'Run as root.'
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[ -x /usr/bin/node ] || fail 'Expected existing /usr/bin/node.'
[ "$(/usr/bin/node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ] || fail 'Node 22 or newer required.'
command -v systemctl >/dev/null || fail 'systemd required.'
command -v curl >/dev/null || fail 'curl required.'
cd "$ROOT"
sha256sum --check SHA256SUMS >/dev/null || fail 'Package integrity check failed.'
[ ! -e /opt/arenda24mo/app ] || fail 'Application directory already exists; review it before installing.'
[ ! -e /etc/systemd/system/arenda24mo-dispatcher.service ] || fail 'Dispatcher service already exists; no overwrite performed.'
[ ! -e /etc/systemd/system/arenda24mo-telegram.service ] || fail 'Telegram service already exists; no overwrite performed.'
if ss -ltn '( sport = :4388 )' | tail -n +2 | grep -q .; then fail 'Port 4388 is busy; no installation performed.'; fi
[ "$(df -Pm /var/lib | tail -n 1 | awk '{print $4}')" -ge 512 ] || fail 'Need at least 512 MiB free disk.'
if getent passwd arenda24mo >/dev/null; then
  [ "$(getent passwd arenda24mo | cut -d: -f6)" = /var/lib/arenda24mo ] || fail 'Existing user has an unexpected home.'
  [ "$(getent passwd arenda24mo | cut -d: -f7)" = /usr/sbin/nologin ] || fail 'Existing user has an unexpected shell.'
else
  useradd --system --user-group --home-dir /var/lib/arenda24mo --no-create-home --shell /usr/sbin/nologin arenda24mo
fi
install -d -o root -g root -m 0755 /opt/arenda24mo /opt/arenda24mo/app
install -d -o root -g arenda24mo -m 0750 /etc/arenda24mo
install -d -o arenda24mo -g arenda24mo -m 0700 /var/lib/arenda24mo
for source in "$ROOT"/app/*; do install -o root -g root -m 0644 "$source" /opt/arenda24mo/app/; done
ln -s /var/lib/arenda24mo /opt/arenda24mo/app/data
install -o root -g root -m 0644 "$ROOT/arenda24mo-dispatcher.service" /etc/systemd/system/arenda24mo-dispatcher.service
install -o root -g root -m 0644 "$ROOT/arenda24mo-telegram.service" /etc/systemd/system/arenda24mo-telegram.service
install -o root -g root -m 0700 "$ROOT/activate.sh" /opt/arenda24mo/activate.sh
printf '%s\n' 'STAGED. Services have not been enabled or started. Credentials and saved state must be transferred separately.'

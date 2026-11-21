#!/usr/bin/env bash
# Builds the extension zip so that the same commit always gives the same bytes: files come from git (not the
# working tree), with fixed timestamps, modes and order, stored without compression so the zip version does
# not change the output. Anyone can rebuild a release from its tag with Info-ZIP zip and compare the sha256
# (other zip tools write a different "version made by" field).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/extension-watch.zip}"
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac

if [ -n "$(git -C "$root" status --porcelain -- extension)" ]; then
  echo "extension/ has uncommitted changes; commit them first so the zip matches a commit" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$root" archive HEAD extension | tar -x -C "$work"

cd "$work/extension"
find . -type d -exec chmod 755 {} +
find . -type f -exec chmod 644 {} +
find . -exec env TZ=UTC touch -h -t 198001010000 {} +
rm -f "$out"
find . -type f | LC_ALL=C sort | TZ=UTC zip -q -X -0 -@ "$out"

# .gitattributes (export-ignore, export-subst) or a symlink would change or drop a committed file without an
# error, so every zip entry must be a committed blob, byte for byte, and no committed file may be missing.
# shortcut: a path with a tab, newline or glob character is quoted or matched differently and fails the check;
# rename such a file rather than supporting it.
want="$(git -C "$root" -c core.quotepath=false ls-tree -r --format='%(objectname) %(path)' HEAD extension | sed 's| extension/| |' | LC_ALL=C sort)"
got="$(unzip -Z1 "$out" | while IFS= read -r f; do printf '%s %s\n' "$(unzip -p "$out" "$f" | git -C "$root" hash-object --stdin)" "$f"; done | LC_ALL=C sort)"
[ "$want" = "$got" ] || { echo "the zip does not hold exactly the committed files under extension/" >&2; diff <(echo "$want") <(echo "$got") >&2; exit 1; }
shasum -a 256 "$out" | cut -d' ' -f1

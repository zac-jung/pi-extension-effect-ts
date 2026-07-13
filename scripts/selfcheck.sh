#!/usr/bin/env bash
# Self-check: end-to-end clone + search against a temp dir (does not touch the
# user cache at ~/.pi/effect-ts-src). Requires git + ripgrep (or grep fallback)
# and network. Fails fast if the tag format, repo structure, or search breaks.
#
#   bash scripts/selfcheck.sh [version]
#
# ponytail: one runnable check for the non-trivial clone/search path.
set -euo pipefail

VERSION="${1:-3.21.4}"
TAG="effect@${VERSION}"
TMP="$(mktemp -d)/effect-selfcheck"
trap 'rm -rf "$(dirname "$TMP")"' EXIT

echo "→ cloning $TAG (shallow) into $TMP"
git clone --depth 1 --branch "$TAG" https://github.com/effect-TS/effect.git "$TMP" >/dev/null 2>&1

# Structure assertions.
test -f "$TMP/packages/effect/src/Effect.ts" || { echo "FAIL: Effect.ts missing"; exit 1; }
test -d "$TMP/packages/platform/src"         || { echo "FAIL: platform/src missing"; exit 1; }

# Search assertion: a known symbol must resolve to a known file.
echo "→ searching for 'export const succeed'"
if command -v rg >/dev/null 2>&1; then
  HITS="$(rg --line-number --color=never --type ts "export const succeed" "$TMP/packages/effect/src" || true)"
else
  HITS="$(grep -rn --include='*.ts' "export const succeed" "$TMP/packages/effect/src" || true)"
fi
echo "$HITS" | grep -q "Effect.ts" || { echo "FAIL: succeed not found in Effect.ts"; exit 1; }

echo "OK: clone + structure + search for effect@${VERSION}"

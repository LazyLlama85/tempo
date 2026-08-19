#!/usr/bin/env bash
# Publish an OTA update with the SAME EXPO_PUBLIC_* values a native build gets.
#
# WHY THIS SCRIPT EXISTS (2026-08-19 — a real, shipped outage, not hygiene).
# `eas.json`'s `build.<profile>.env` is read by `eas build`. It is NOT read by
# `eas update`: an update resolves env from the EAS *environment variable store*
# for `--environment <name>`, which is a completely separate place. This project's
# store holds only the Supabase pair, so every OTA published with a bare
# `eas update` silently shipped a bundle with:
#   • no EXPO_PUBLIC_REVENUECAT_KEY   → RevenueCat never configures; the paywall
#     reports plans unavailable and NOTHING can be purchased
#   • no EXPO_PUBLIC_POSTHOG_KEY      → zero analytics (so the failure is invisible)
#   • no EXPO_PUBLIC_SENTRY_DSN       → zero crash reporting
#   • no EXPO_PUBLIC_RAPIDAPI_KEY     → uncached exercise media never loads
# Supabase kept working, which is exactly why this went unnoticed: the app looked
# fine and was missing its entire monetization + telemetry layer.
#
# The failure is silent by construction — every one of those modules is written to
# no-op safely without its key. So the fix has to be mechanical, not vigilance:
# always publish through this script, never `eas update` directly.
#
# Usage:  scripts/publish-update.sh <branch> "<message>" [profile]
#         (profile defaults to the branch name)
set -euo pipefail

BRANCH="${1:?usage: publish-update.sh <branch> \"<message>\" [profile]}"
MESSAGE="${2:?usage: publish-update.sh <branch> \"<message>\" [profile]}"
PROFILE="${3:-$BRANCH}"

cd "$(dirname "$0")/.."

# Export every EXPO_PUBLIC_* from the build profile into this process, so Metro
# inlines the same values `eas build` would. Existing values in the environment
# win, so a caller can still override one deliberately.
eval "$(
  PROFILE="$PROFILE" node -e '
    const fs = require("fs");
    const profile = process.env.PROFILE;
    const eas = JSON.parse(fs.readFileSync("eas.json", "utf8"));
    const env = ((eas.build || {})[profile] || {}).env || {};
    const keys = Object.keys(env).filter((k) => k.startsWith("EXPO_PUBLIC_"));
    if (keys.length === 0) {
      console.error(`No EXPO_PUBLIC_* env found for build profile "${profile}" in eas.json`);
      process.exit(1);
    }
    for (const k of keys) {
      // ${k:-default} leaves an already-set value alone.
      console.log(`export ${k}="\${${k}:-${String(env[k]).replace(/(["$`\\])/g, "\\$1")}}"`);
    }
    console.error(`Inlining ${keys.length} EXPO_PUBLIC_* vars from eas.json build.${profile}.env`);
  '
)"

# Fail loudly rather than shipping another key-less bundle.
for required in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
                EXPO_PUBLIC_REVENUECAT_KEY EXPO_PUBLIC_POSTHOG_KEY; do
  if [ -z "${!required:-}" ]; then
    echo "Refusing to publish: $required is empty." >&2
    exit 1
  fi
done

exec npx --yes eas-cli@latest update \
  --branch "$BRANCH" \
  --environment "$PROFILE" \
  --message "$MESSAGE" \
  --non-interactive

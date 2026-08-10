#!/usr/bin/env bash
set -euo pipefail

# package.json is the source of truth for plugin metadata; plugin.json follows it.
# semantic-release bumps package.json, then calls this to keep the manifest in sync.

cd "$(dirname "${BASH_SOURCE[0]}")/.."

tmp="$(mktemp)"
jq \
  --arg version "$(jq -r '.version' package.json)" \
  --arg description "$(jq -r '.description' package.json)" \
  '.version = $version | .description = $description' \
  .claude-plugin/plugin.json > "$tmp"
mv "$tmp" .claude-plugin/plugin.json

echo "plugin.json synced to $(jq -r '.version' package.json)"

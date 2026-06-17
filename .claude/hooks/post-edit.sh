#!/usr/bin/env bash

# Read all hook input from stdin (Claude Code PostToolUse passes JSON here)
HOOK_INPUT=$(cat)

# Extract edited file path from the hook JSON payload
if command -v jq >/dev/null 2>&1; then
  FILE=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty')
else
  FILE=$(printf '%s' "$HOOK_INPUT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('tool_input',{}).get('file_path',''))")
fi

if [[ -z "$FILE" ]]; then
  exit 0
fi

# Risk-area files — vitest related runs on edits to these (in addition to lint)
# Phase 2 will add: src/pages/api/auth/delete-account.ts
RISK_AREAS=(
  "src/middleware.ts"
  "src/lib/openrouter.ts"
  "src/pages/api/plans/[id].ts"
)

FAILED=0

# Always run lint on the edited file
npx eslint "$FILE" || FAILED=1

# Run vitest related only when the file is a risk-area file
for RISK in "${RISK_AREAS[@]}"; do
  if [[ "$FILE" == "$RISK" ]]; then
    npx vitest related "$FILE" --run || FAILED=1
    break
  fi
done

if [[ $FAILED -ne 0 ]]; then
  exit 2
fi

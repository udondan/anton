#!/usr/bin/env bash
# Replaces placeholder names with real names before running evals.
#
# Required env vars:
#   ANTON_CHILD_LEA        — real display name for Lea
#   ANTON_CHILD_LUKE       — real display name for Luke
#   ANTON_SKILL_TEST_GROUP — real group name for Skywalker
#
# Usage:
#   ./scripts/prepare-evals.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${ANTON_CHILD_LEA:-}" || -z "${ANTON_CHILD_LUKE:-}" || -z "${ANTON_SKILL_TEST_GROUP:-}" ]]; then
  echo "Error: ANTON_CHILD_LEA, ANTON_CHILD_LUKE and ANTON_SKILL_TEST_GROUP must be set." >&2
  exit 1
fi

replace_in_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    python3 - "$file" "$ANTON_CHILD_LEA" "$ANTON_CHILD_LUKE" "$ANTON_SKILL_TEST_GROUP" <<'PY'
import pathlib
import re
import sys

file_path = pathlib.Path(sys.argv[1])
lea = sys.argv[2]
luke = sys.argv[3]
skywalker = sys.argv[4]

content = file_path.read_text()
updated = re.sub(r"\bLea\b", lambda _: lea, content)
updated = re.sub(r"\bLuke\b", lambda _: luke, updated)
updated = re.sub(r"\bSkywalker\b", lambda _: skywalker, updated)

if updated != content:
    file_path.write_text(updated)
PY
    echo "Prepared: $file"
  fi
}

# Replace in evals
replace_in_file "${ROOT}/skills/anton/evals/evals.json"

# Replace in all workspace files
for f in \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/eval-*/eval_metadata.json \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/eval-*/with_skill/outputs/* \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/eval-*/without_skill/outputs/* \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/eval-*/grading.json \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/benchmark.json \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/benchmark.md; do
  replace_in_file "$f"
done

echo "Done. Real names are now in eval files. Run finalize-evals.sh when finished."

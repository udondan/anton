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
    sed -i.bak \
      -e "s/[[:<:]]Lea[[:>:]]/${ANTON_CHILD_LEA}/g" \
      -e "s/[[:<:]]Luke[[:>:]]/${ANTON_CHILD_LUKE}/g" \
      -e "s/[[:<:]]Skywalker[[:>:]]/${ANTON_SKILL_TEST_GROUP}/g" \
      "$file"
    rm -f "${file}.bak"
    echo "Prepared: $file"
  fi
}

# Replace in evals
replace_in_file "${ROOT}/skills/anton/evals/evals.json"

# Replace in any workspace eval metadata that may already exist
for f in "${ROOT}"/anton-skill-workspace/iteration-*/eval-*/eval_metadata.json; do
  replace_in_file "$f"
done

echo "Done. Real names are now in eval files. Run finalize-evals.sh when finished."

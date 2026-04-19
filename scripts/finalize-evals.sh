#!/usr/bin/env bash
# Replaces real names back with placeholders after evals are done.
#
# Required env vars:
#   ANTON_CHILD_LEA        — real display name for Lea
#   ANTON_CHILD_LUKE       — real display name for Luke
#   ANTON_SKILL_TEST_GROUP — real group name for Skywalker
#
# Usage:
#   ./scripts/finalize-evals.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${ANTON_CHILD_LEA:-}" || -z "${ANTON_CHILD_LUKE:-}" || -z "${ANTON_SKILL_TEST_GROUP:-}" ]]; then
  echo "Error: ANTON_CHILD_LEA, ANTON_CHILD_LUKE and ANTON_SKILL_TEST_GROUP must be set." >&2
  exit 1
fi

replace_in_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    # Also match markdown-escaped variants (e.g. Name\<3 when < is escaped as \<)
    local lea_escaped="${ANTON_CHILD_LEA//</'\\<'}"
    local luke_escaped="${ANTON_CHILD_LUKE//</'\\<'}"
    sed -i.bak \
      -e "s/${ANTON_CHILD_LEA}/Lea/g" \
      -e "s/${lea_escaped}/Lea/g" \
      -e "s/${ANTON_CHILD_LUKE}/Luke/g" \
      -e "s/${luke_escaped}/Luke/g" \
      -e "s/${ANTON_SKILL_TEST_GROUP}/Skywalker/g" \
      "$file"
    rm -f "${file}.bak"
    echo "Anonymized: $file"
  fi
}

# Restore evals
replace_in_file "${ROOT}/skills/anton/evals/evals.json"

# Anonymize all workspace output files
for f in \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/eval-*/eval_metadata.json \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/eval-*/with_skill/outputs/* \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/eval-*/without_skill/outputs/* \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/eval-*/grading.json \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/benchmark.json \
  "${ROOT}"/skills/anton-skill-workspace/iteration-*/benchmark.md; do
  replace_in_file "$f"
done

echo "Done. All files anonymized — safe to commit."

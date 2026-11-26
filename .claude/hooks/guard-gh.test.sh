#!/usr/bin/env bash
# Runs guard-gh.sh against PreToolUse JSON fixtures.
set -u
set -f

HOOK=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/guard-gh.sh
fail=0

assert_exec() {
  if [[ ! -x "$HOOK" ]]; then
    printf 'FAIL executable bit missing on %s\n' "$HOOK" >&2
    fail=1
  fi
}

run_case() {
  local name="$1"
  local expect="$2"
  local needle="$3"
  local cmd="$4"
  local json out code
  json=$(python3 -c 'import json,sys; print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]}}))' "$cmd")
  set +e
  out=$(printf '%s' "$json" | "$HOOK")
  code=$?
  set -e
  if (( code != 0 )); then
    printf 'FAIL %s exit %s\n' "$name" "$code" >&2
    fail=1
    return
  fi
  if [[ "$expect" == "allow" ]]; then
    if [[ -n "$out" ]]; then
      printf 'FAIL %s expected allow, got %s\n' "$name" "$out" >&2
      fail=1
    fi
    return
  fi
  if [[ "$out" != *'"permissionDecision": "deny"'* && "$out" != *'"permissionDecision":"deny"'* ]]; then
    printf 'FAIL %s expected deny, got %s\n' "$name" "$out" >&2
    fail=1
    return
  fi
  if [[ -n "$needle" && "$out" != *"$needle"* ]]; then
    printf 'FAIL %s reason missing %s in %s\n' "$name" "$needle" "$out" >&2
    fail=1
  fi
}

run_raw() {
  local name="$1"
  local expect="$2"
  local raw="$3"
  local out code
  set +e
  out=$(printf '%s' "$raw" | "$HOOK")
  code=$?
  set -e
  if (( code != 0 )); then
    printf 'FAIL %s exit %s\n' "$name" "$code" >&2
    fail=1
    return
  fi
  if [[ "$expect" == "deny" ]]; then
    if [[ "$out" != *'"permissionDecision": "deny"'* && "$out" != *'"permissionDecision":"deny"'* ]]; then
      printf 'FAIL %s expected deny, got %s\n' "$name" "$out" >&2
      fail=1
    fi
  fi
}

assert_exec

REPO='EduardoMoraga/edu-bot'
OTHER='milind-soni/OpenMausBot'

run_case allow-pr-list allow "" "gh pr list --repo ${REPO}"
run_case allow-equals allow "" "gh pr list --repo=${REPO}"
run_case allow-quoted allow "" "gh pr list --repo \"${REPO}\""
run_case allow-global-flag allow "" "gh --repo ${REPO} pr view 12"
run_case allow-url allow "" "gh pr list --repo https://github.com/${REPO}"
run_case allow-command-wrapper allow "" "command gh pr list --repo ${REPO}"
run_case allow-timeout allow "" "timeout 30 gh pr list --repo ${REPO}"
run_case allow-and allow "" "cd /tmp && gh pr list --repo ${REPO}"
run_case allow-echo-word allow "" "echo gh pr list"
run_case allow-single-quoted allow "" "echo 'gh pr list'"
run_case allow-git allow "" "git status"
run_case allow-api-self allow "" "gh api repos/${REPO}/pulls --repo ${REPO}"
run_case allow-header allow "" "gh api user --repo ${REPO} -H Accept: application/json"
run_case allow-comment allow "" "echo ok"

run_case deny-no-repo deny "--repo" "gh pr list"
run_case deny-short-only deny "--repo" "gh pr list -R ${REPO}"
run_case deny-other deny "target" "gh pr list --repo ${OTHER}"
run_case deny-second-repo deny "target" "gh pr list --repo ${REPO} --repo ${OTHER}"
run_case deny-short-other deny "target" "gh pr list --repo ${REPO} -R ${OTHER}"
run_case deny-merge deny "merge" "gh pr merge --repo ${REPO}"
run_case deny-merge-bare deny "merge" "gh pr merge 12"
run_case deny-merge-global deny "merge" "gh --repo ${REPO} pr merge 3"
run_case deny-merge-after-flag deny "merge" "gh --jq . pr merge --repo ${REPO}"
run_case allow-jq allow "" "gh pr list --repo ${REPO} --jq ."
run_case allow-pipe allow "" "gh pr list --repo ${REPO} | cat"
run_case allow-group allow "" "{ gh pr list --repo ${REPO}; }"
run_case allow-cont allow "" $'gh pr list \\\n  --repo '"${REPO}"
run_case deny-bare deny "--repo" "gh"
run_case deny-env-only deny "--repo" "GH_REPO=${REPO} gh pr list"
run_case allow-same-env allow "" "GH_REPO=${REPO} gh pr list --repo ${REPO}"
run_case allow-clone-self allow "" "gh repo clone ${REPO} --repo ${REPO}"
run_case deny-env deny "target" "GH_REPO=${OTHER} gh pr list --repo ${REPO}"
run_case deny-env-wrapper deny "target" "env GH_REPO=${OTHER} gh pr list --repo ${REPO}"
run_case deny-second-cmd deny "--repo" "gh pr list --repo ${REPO} && gh pr list"
run_case deny-subst deny "--repo" "echo \"\$(gh pr list)\""
run_case deny-subshell deny "--repo" "(gh pr list)"
run_case deny-clone deny "target" "gh repo clone ${OTHER} --repo ${REPO}"
run_case deny-api-other deny "target" "gh api repos/other/name/pulls --repo ${REPO}"
run_case deny-upstream-body deny "target" "gh pr comment 1 --repo ${REPO} --body 'see ${OTHER}'"

run_raw deny-bad-json deny "{"
run_raw deny-no-command deny "{}"

if (( fail != 0 )); then
  printf 'guard-gh tests failed\n' >&2
  exit 1
fi
printf 'guard-gh tests passed\n'

#!/usr/bin/env bash
# Claude Code PreToolUse hook: JSON on stdin, decision JSON on stdout (exit 0).
# gh may name only EduardoMoraga/edu-bot via --repo, and `gh pr merge` never runs.
set -u
set -f

ALLOWED='EduardoMoraga/edu-bot'
UPSTREAM='milind-soni/OpenMausBot'

SRC=''
N=0
I=0
WORD=''
REASON=''

emit_deny() {
  local reason="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":sys.argv[1]}}))' "$reason"
  elif command -v jq >/dev/null 2>&1; then
    jq -nc --arg reason "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  else
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"gh is blocked by guard-gh."}}'
  fi
}

extract_command() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
raw=sys.stdin.read()
try:
    data=json.loads(raw)
except Exception:
    sys.exit(2)
if not isinstance(data, dict):
    sys.exit(2)
tool=data.get("tool_input")
if not isinstance(tool, dict):
    sys.exit(2)
cmd=tool.get("command")
if not isinstance(cmd, str):
    sys.exit(2)
sys.stdout.write(cmd)
'
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -er '.tool_input.command | strings'
    return
  fi
  return 1
}

fail() {
  REASON=$1
  return 1
}

normalize_repo() {
  local v="$1"
  while [[ "$v" == */ ]]; do
    v="${v%/}"
  done
  v="${v%.git}"
  v="${v#https://github.com/}"
  v="${v#http://github.com/}"
  v="${v#ssh://git@github.com/}"
  v="${v#git@github.com:}"
  v="${v#github.com/}"
  v="${v#github.com:}"
  printf '%s' "$v"
}

is_gh() {
  [[ "$1" == "gh" || "$1" == */gh ]]
}

word_targets_other() {
  local rest="$1"
  local pair matched
  [[ "$rest" == *"$UPSTREAM"* ]] && return 0
  while [[ "$rest" =~ github\.com[:/]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+) ]]; do
    pair="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    pair="${pair%.git}"
    [[ "$pair" != "$ALLOWED" ]] && return 0
    matched="${BASH_REMATCH[0]}"
    rest="${rest#*"$matched"}"
  done
  rest="$1"
  while [[ "$rest" =~ repos/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+) ]]; do
    pair="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    [[ "$pair" != "$ALLOWED" ]] && return 0
    matched="${BASH_REMATCH[0]}"
    rest="${rest#*"$matched"}"
  done
  return 1
}

other_slug() {
  local v="$1"
  local norm
  [[ "$v" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.][A-Za-z0-9_.-]*$ ]] || return 1
  case "$v" in
    application/*|text/*|image/*|audio/*|video/*|multipart/*|font/*) return 1 ;;
  esac
  norm=$(normalize_repo "$v")
  [[ "$norm" != "$ALLOWED" ]]
}

record_repo() {
  local kind="$1"
  local raw="$2"
  local norm
  norm=$(normalize_repo "$raw")
  if [[ "$norm" != "$ALLOWED" ]]; then
    fail "gh must target ${ALLOWED} only." || return
  fi
  if [[ "$kind" == "long" ]]; then
    have_long=1
  fi
}

check_gh_invocation() {
  local -a args=("$@")
  local -a positionals=()
  local have_long=0
  local i=0
  local n=${#args[@]}
  local t
  while (( i < n )); do
    t="${args[$i]}"
    if [[ "$t" == "--" ]]; then
      if (( i + 1 < n )); then
        positionals+=("${args[@]:i+1}")
      fi
      break
    fi
    if [[ "$t" == "--repo" || "$t" == "-R" ]]; then
      i=$((i + 1))
      if (( i >= n )); then
        fail "gh must include --repo ${ALLOWED}." || return
      fi
      if [[ "$t" == "--repo" ]]; then
        record_repo long "${args[$i]}" || return
      else
        record_repo short "${args[$i]}" || return
      fi
      i=$((i + 1))
      continue
    fi
    if [[ "$t" == --repo=* ]]; then
      record_repo long "${t#--repo=}" || return
      i=$((i + 1))
      continue
    fi
    if [[ "$t" == -R=* ]]; then
      record_repo short "${t#-R=}" || return
      i=$((i + 1))
      continue
    fi
    if [[ "$t" == -R* && "$t" == */* ]]; then
      record_repo short "${t#-R}" || return
      i=$((i + 1))
      continue
    fi
    if [[ "$t" == -* ]]; then
      i=$((i + 1))
      continue
    fi
    positionals+=("$t")
    i=$((i + 1))
  done

  local sub=""
  local pi
  if (( ${#positionals[@]} > 0 )); then
    sub="${positionals[0]}"
  fi
  for (( pi = 0; pi + 1 < ${#positionals[@]}; pi++ )); do
    if [[ "${positionals[$pi]}" == "pr" && "${positionals[$((pi + 1))]}" == "merge" ]]; then
      fail "gh pr merge is blocked. A PR needs green CI and Eduardo's approval." || return
    fi
  done

  local p
  if [[ "$sub" == "repo" || "$sub" == "browse" ]]; then
    for p in "${positionals[@]}"; do
      if other_slug "$p"; then
        fail "gh must target ${ALLOWED} only." || return
      fi
    done
  fi

  local a
  for a in "${args[@]}"; do
    if word_targets_other "$a"; then
      fail "gh must target ${ALLOWED} only." || return
    fi
  done

  if (( have_long != 1 )); then
    fail "gh must include --repo ${ALLOWED}." || return
  fi
}

skip_wrapper() {
  local t="${w[$i]}"
  case "$t" in
    command|builtin|noglob|nocorrect|nohup)
      i=$((i + 1))
      return 0
      ;;
    time)
      i=$((i + 1))
      if [[ "${w[$i]:-}" == "-p" ]]; then
        i=$((i + 1))
      fi
      return 0
      ;;
    nice)
      i=$((i + 1))
      if [[ "${w[$i]:-}" == "-n" ]]; then
        i=$((i + 2))
      elif [[ "${w[$i]:-}" == -n* ]]; then
        i=$((i + 1))
      fi
      return 0
      ;;
    timeout)
      i=$((i + 1))
      while (( i < n )) && [[ "${w[$i]}" == -* ]]; do
        local f="${w[$i]}"
        if [[ "$f" == "--" ]]; then
          i=$((i + 1))
          break
        fi
        case "$f" in
          --signal|-s|--kill-after|-k)
            i=$((i + 2))
            continue
            ;;
        esac
        i=$((i + 1))
      done
      if (( i < n )) && ! is_gh "${w[$i]}"; then
        i=$((i + 1))
      fi
      return 0
      ;;
    env)
      i=$((i + 1))
      while (( i < n )); do
        local e="${w[$i]}"
        if [[ "$e" == "--" ]]; then
          i=$((i + 1))
          break
        fi
        if [[ "$e" == -* ]]; then
          i=$((i + 1))
          continue
        fi
        if [[ "$e" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
          if [[ "$e" == GH_REPO=* ]]; then
            repo_env+=("${e#GH_REPO=}")
          fi
          i=$((i + 1))
          continue
        fi
        break
      done
      return 0
      ;;
    stdbuf|xargs)
      i=$((i + 1))
      while (( i < n )) && [[ "${w[$i]}" == -* ]]; do
        i=$((i + 1))
      done
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

eval_words() {
  local -a w=("$@")
  local -a repo_env=()
  local i=0
  local n=${#w[@]}
  local t cmd e norm
  while (( i < n )); do
    t="${w[$i]}"
    if [[ "$t" == "{" || "$t" == "}" ]]; then
      i=$((i + 1))
      continue
    fi
    if [[ "$t" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      if [[ "$t" == GH_REPO=* ]]; then
        repo_env+=("${t#GH_REPO=}")
      fi
      i=$((i + 1))
      continue
    fi
    if skip_wrapper; then
      continue
    fi
    break
  done
  (( i >= n )) && return 0
  cmd="${w[$i]}"
  if is_gh "$cmd"; then
    for e in "${repo_env[@]}"; do
      norm=$(normalize_repo "$e")
      if [[ "$norm" != "$ALLOWED" ]]; then
        fail "gh must target ${ALLOWED} only." || return
      fi
    done
    if (( i + 1 < n )); then
      check_gh_invocation "${w[@]:i+1}" || return
    else
      check_gh_invocation || return
    fi
  fi
}

skip_hws() {
  local c
  while (( I < N )); do
    c="${SRC:$I:1}"
    [[ "$c" == " " || "$c" == $'\t' ]] || break
    I=$((I + 1))
  done
}

skip_comment() {
  while (( I < N )) && [[ "${SRC:$I:1}" != $'\n' ]]; do
    I=$((I + 1))
  done
}

scan_fragment() {
  local fragment="$1"
  local saved_src="$SRC"
  local saved_i="$I"
  local saved_n="$N"
  local status
  SRC="$fragment"
  I=0
  N=${#fragment}
  parse_list eof
  status=$?
  SRC="$saved_src"
  I="$saved_i"
  N="$saved_n"
  return "$status"
}

parse_substitution() {
  local c inner closed
  if [[ "${SRC:$I:2}" == '$(' ]]; then
    I=$((I + 2))
    parse_list paren || return
    if (( I >= N )) || [[ "${SRC:$I:1}" != ")" ]]; then
      fail "guard-gh could not read the Bash command." || return
    fi
    I=$((I + 1))
    return 0
  fi
  if [[ "${SRC:$I:1}" == '`' ]]; then
    I=$((I + 1))
    inner=""
    closed=0
    while (( I < N )); do
      c="${SRC:$I:1}"
      if [[ "$c" == "\\" ]]; then
        I=$((I + 1))
        if (( I >= N )); then
          fail "guard-gh could not read the Bash command." || return
        fi
        inner+="${SRC:$I:1}"
        I=$((I + 1))
        continue
      fi
      if [[ "$c" == '`' ]]; then
        I=$((I + 1))
        closed=1
        break
      fi
      inner+="$c"
      I=$((I + 1))
    done
    if (( closed == 0 )); then
      fail "guard-gh could not read the Bash command." || return
    fi
    scan_fragment "$inner" || return
    return 0
  fi
  fail "guard-gh could not read the Bash command." || return
}

parse_word() {
  WORD=""
  local any=0
  local c closed e saved
  while (( I < N )); do
    c="${SRC:$I:1}"
    case "$c" in
      " "|$'\t'|$'\n'|";"|"&"|"|"|"("|")"|"<"|">")
        break
        ;;
      "\\")
        I=$((I + 1))
        if (( I >= N )); then
          fail "guard-gh could not read the Bash command." || return
        fi
        e="${SRC:$I:1}"
        I=$((I + 1))
        if [[ "$e" != $'\n' ]]; then
          WORD+="$e"
        fi
        any=1
        ;;
      "'")
        I=$((I + 1))
        closed=0
        while (( I < N )); do
          c="${SRC:$I:1}"
          if [[ "$c" == "'" ]]; then
            I=$((I + 1))
            closed=1
            break
          fi
          WORD+="$c"
          I=$((I + 1))
        done
        if (( closed == 0 )); then
          fail "guard-gh could not read the Bash command." || return
        fi
        any=1
        ;;
      '"')
        I=$((I + 1))
        closed=0
        while (( I < N )); do
          c="${SRC:$I:1}"
          if [[ "$c" == '"' ]]; then
            I=$((I + 1))
            closed=1
            break
          fi
          if [[ "$c" == "\\" ]]; then
            I=$((I + 1))
            if (( I >= N )); then
              fail "guard-gh could not read the Bash command." || return
            fi
            e="${SRC:$I:1}"
            I=$((I + 1))
            case "$e" in
              "$"|'`'|'"'|"\\") WORD+="$e" ;;
              $'\n') ;;
              *) WORD+="\\$e" ;;
            esac
            continue
          fi
          if [[ "$c" == '`' || "${SRC:$I:2}" == '$(' ]]; then
            saved="$WORD"
            parse_substitution || return
            WORD="$saved"
            continue
          fi
          WORD+="$c"
          I=$((I + 1))
        done
        if (( closed == 0 )); then
          fail "guard-gh could not read the Bash command." || return
        fi
        any=1
        ;;
      '`')
        saved="$WORD"
        parse_substitution || return
        WORD="$saved"
        any=1
        ;;
      '$')
        if [[ "${SRC:$I:2}" == '$(' ]]; then
          saved="$WORD"
          parse_substitution || return
          WORD="$saved"
          any=1
        else
          WORD+="$c"
          I=$((I + 1))
          any=1
        fi
        ;;
      *)
        WORD+="$c"
        I=$((I + 1))
        any=1
        ;;
    esac
  done
  if (( any == 0 )); then
    fail "guard-gh could not read the Bash command." || return
  fi
}

parse_simple() {
  local -a words=()
  local c
  while (( I < N )); do
    skip_hws
    (( I >= N )) && break
    c="${SRC:$I:1}"
    case "$c" in
      $'\n'|";"|"&"|"|"|")"|"#")
        break
        ;;
      "(")
        I=$((I + 1))
        parse_list paren || return
        if (( I >= N )) || [[ "${SRC:$I:1}" != ")" ]]; then
          fail "guard-gh could not read the Bash command." || return
        fi
        I=$((I + 1))
        ;;
      *)
        parse_word || return
        words+=("$WORD")
        ;;
    esac
  done
  if (( ${#words[@]} > 0 )); then
    eval_words "${words[@]}" || return
  fi
}

parse_list() {
  local stop="${1:-eof}"
  local c before
  while (( I < N )); do
    skip_hws
    (( I >= N )) && break
    c="${SRC:$I:1}"
    if [[ "$c" == ")" ]]; then
      if [[ "$stop" == "paren" ]]; then
        return 0
      fi
      fail "guard-gh could not read the Bash command." || return
    fi
    if [[ "$c" == "#" ]]; then
      skip_comment
      continue
    fi
    if [[ "$c" == ";" || "$c" == $'\n' ]]; then
      I=$((I + 1))
      continue
    fi
    if [[ "$c" == "&" ]]; then
      if [[ "${SRC:$I:2}" == "&&" ]]; then
        I=$((I + 2))
      else
        I=$((I + 1))
      fi
      continue
    fi
    if [[ "$c" == "|" ]]; then
      if [[ "${SRC:$I:2}" == "||" || "${SRC:$I:2}" == "|&" ]]; then
        I=$((I + 2))
      else
        I=$((I + 1))
      fi
      continue
    fi
    before=$I
    parse_simple || return
    if (( I == before )); then
      fail "guard-gh could not read the Bash command." || return
    fi
  done
  if [[ "$stop" == "paren" ]]; then
    fail "guard-gh could not read the Bash command." || return
  fi
}

check_text() {
  SRC="$1"
  I=0
  N=${#SRC}
  REASON=""
  parse_list eof
}

main() {
  local cmd
  if ! cmd=$(extract_command); then
    emit_deny "guard-gh could not read the Bash command."
    exit 0
  fi
  if check_text "$cmd"; then
    exit 0
  fi
  if [[ -z "$REASON" ]]; then
    REASON="gh must include --repo ${ALLOWED}."
  fi
  emit_deny "$REASON"
  exit 0
}

main

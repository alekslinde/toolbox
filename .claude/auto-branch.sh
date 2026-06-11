#!/usr/bin/env bash
# Auto-creates or renames a fix/ or feature/ branch before implementation tasks.
# Fires on UserPromptSubmit; no-ops when already off main unless asked to rename.
set -euo pipefail

input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // ""')
current=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

# ── Rename mode: "rename (current|this) branch …" ───────────────────────────
if echo "$prompt" | grep -qiE '^[[:space:]]*(rename|rename (current|this) branch)'; then
  # Slug from the remainder of the prompt after "rename [current|this] branch [to]"
  new_slug=$(echo "$prompt" \
    | sed 's/^[[:space:]]*rename[[:space:]]*//' \
    | sed 's/^(current|this)[[:space:]]*branch[[:space:]]*//' \
    | sed 's/^to[[:space:]]*//' \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9 ]//g' \
    | tr -s ' ' \
    | awk '{
        n=split($0,w," ");
        stop=" a an the for to in of on at by with from and or but ";
        s=""; c=0;
        for(i=1;i<=n && c<5;i++) {
          if (index(stop," " w[i] " ") == 0) { s=s (c>0?"-":"") w[i]; c++ }
        }
        print s
      }' \
    | cut -c1-50 \
    | sed 's/-*$//')

  # Inherit prefix from current branch if it has one, else default to feature/
  prefix=$(echo "$current" | grep -oE '^(fix|feature|refactor)/' || echo "feature/")
  new_branch="${prefix}${new_slug}"
  [[ -z "$new_slug" || "$new_branch" == "$current" ]] && exit 0
  git branch -m "$current" "$new_branch"
  jq -n --arg b "$new_branch" \
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":("Branch renamed to " + $b + ".")}}'
  exit 0
fi

# Only create a new branch when on main/master
[[ "$current" != "main" && "$current" != "master" ]] && exit 0

# Skip slash commands (/build, /ship, /check-console, etc.)
echo "$prompt" | grep -qE '^[[:space:]]*/' && exit 0

# Skip questions and ops commands. Trailing ([^[:alpha:]]|$) is a POSIX-portable word
# boundary (works in both BSD grep and ugrep), so "list" does not match "listing" and
# "check" does not match "checkout".
echo "$prompt" | grep -qiE '^[[:space:]]*(what|how|why|when|where|explain|describe|is|are|can you|do you|does|show me|list|tell me|push|deploy|ship|check)([^[:alpha:]]|$)' && exit 0

# Skip prompts ending with a question mark
echo "$prompt" | grep -qE '\?[[:space:]]*$' && exit 0

# Skip very short prompts
[[ ${#prompt} -lt 8 ]] && exit 0

# Classify fix vs feature vs refactor
if echo "$prompt" | grep -qiE '(^|[^[:alpha:]])(fix|bug|broken|error|crash|revert|regression)([^[:alpha:]]|$)'; then
  type="fix"
elif echo "$prompt" | grep -qiE '(^|[^[:alpha:]])(refactor|cleanup|clean up|extract|rename|reorganize|move)([^[:alpha:]]|$)'; then
  type="refactor"
else
  type="feature"
fi

# Slug: lowercase, strip stop words & punctuation, first 5 meaningful words, max 50 chars
slug=$(echo "$prompt" \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9 ]//g' \
  | tr -s ' ' \
  | awk '{
      n=split($0,w," ");
      stop=" a an the for to in of on at by with from and or but ";
      s=""; c=0;
      for(i=1;i<=n && c<5;i++) {
        if (index(stop," " w[i] " ") == 0) { s=s (c>0?"-":"") w[i]; c++ }
      }
      print s
    }' \
  | cut -c1-50 \
  | sed 's/-*$//')

branch="${type}/${slug}"
git checkout -b "$branch" 2>/dev/null || exit 0

jq -n --arg b "$branch" \
  '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":("Branch " + $b + " created and checked out. Implement here, then /ship when done.")}}'

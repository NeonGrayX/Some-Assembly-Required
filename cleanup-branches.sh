#!/usr/bin/env bash
# Cleanup: delete every local branch except main, and forget remote-tracking
# branches that no longer exist on their remote.
# Usage: ./cleanup-branches.sh [--dry-run] [--force]
# Switches to main first (the working tree must be clean for that). A branch with
# commits that are on no remote is kept unless --force is given, so unpushed work
# is not lost by accident; run ./sync.sh or push it first. Branches checked out in
# another worktree are skipped.
set -euo pipefail

cd "$(dirname "$0")"

KEEP="main"

fail() { echo "cleanup: $*" >&2; exit 1; }
warn() { echo "cleanup: $*" >&2; }

DRY_RUN=""
FORCE=""
for arg in "$@"; do
    case "$arg" in
        -n | --dry-run) DRY_RUN=1 ;;
        -f | --force) FORCE=1 ;;
        *) fail "unknown option ${arg}; usage: $0 [--dry-run] [--force]" ;;
    esac
done

# Fresh remote state, so a branch merged on a remote counts as pushed.
for remote in $(git remote); do
    git fetch --quiet --prune "$remote" || warn "could not fetch from ${remote}; using what is known locally"
done

if [ "$(git branch --show-current)" != "$KEEP" ]; then
    git diff --quiet && git diff --cached --quiet || fail "uncommitted changes; commit or stash them before switching to ${KEEP}"
    [ -n "$DRY_RUN" ] && echo "Would switch to ${KEEP}" || git switch --quiet "$KEEP"
fi

git worktree prune
# Branches checked out in any worktree, this one included.
checked_out="$(git worktree list --porcelain | sed -n 's|^branch refs/heads/||p')"

deleted=0
kept=0
while read -r branch; do
    [ "$branch" = "$KEEP" ] && continue
    if grep -qxF "$branch" <<<"$checked_out"; then
        warn "skipped ${branch}: checked out in another worktree"
        kept=$((kept + 1))
        continue
    fi
    if [ -z "$FORCE" ] && [ -z "$(git branch -r --contains "refs/heads/${branch}")" ]; then
        warn "kept ${branch}: has commits on no remote (use --force to delete it anyway)"
        kept=$((kept + 1))
        continue
    fi
    if [ -n "$DRY_RUN" ]; then
        echo "Would delete ${branch}"
    else
        git branch --quiet -D "$branch"
        echo "Deleted ${branch}"
    fi
    deleted=$((deleted + 1))
done < <(git for-each-ref --format='%(refname:short)' refs/heads)

echo "${deleted} branch(es) $([ -n "$DRY_RUN" ] && echo "to delete" || echo "deleted"), ${kept} kept"

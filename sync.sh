#!/usr/bin/env bash
# Sync: bring every remote (origin on Gitea, github) up to date with the others.
# Usage: ./sync.sh [--dry-run]
# Fetches all remotes, then for each branch takes the newest tip found on any
# remote or locally and pushes it to every remote that is behind or lacks it.
# Pushes only fast-forward, so nothing on a remote is ever overwritten; a branch
# that has diverged is reported and left alone. Local branches that exist on a
# remote are fast-forwarded too; local-only branches are not pushed.
# Tags are pushed to every remote except origin: a new tag there starts a deploy
# (see deploy.sh).
set -euo pipefail

cd "$(dirname "$0")"

DEPLOY_REMOTE="origin"

fail() { echo "sync: $*" >&2; exit 1; }
warn() { echo "sync: $*" >&2; }

DRY_RUN=""
case "${1:-}" in
    "") ;;
    -n | --dry-run) DRY_RUN=1 ;;
    *) fail "unknown option $1; usage: $0 [--dry-run]" ;;
esac

mapfile -t remotes < <(git remote)
[ "${#remotes[@]}" -gt 0 ] || fail "no remotes configured"

for remote in "${remotes[@]}"; do
    echo "Fetching ${remote}"
    # A tag that differs between remotes makes fetch report an error; the branches
    # still arrive, so carry on.
    git fetch --quiet --prune --tags "$remote" || warn "fetch from ${remote} reported errors"
done

# The newest of the given commits, if they all lie on one line of history.
newest_of() {
    local best="" sha
    for sha in "$@"; do
        if [ -z "$best" ] || git merge-base --is-ancestor "$best" "$sha"; then
            best="$sha"
        elif ! git merge-base --is-ancestor "$sha" "$best"; then
            return 1
        fi
    done
    echo "$best"
}

current="$(git branch --show-current)"
checked_out="$(git worktree list --porcelain | sed -n 's|^branch refs/heads/||p')"

declare -A refspecs=()
problems=0

# Every branch name on any remote.
mapfile -t branches < <(
    for remote in "${remotes[@]}"; do
        git for-each-ref --format='%(refname)' "refs/remotes/${remote}/" | sed "s|^refs/remotes/${remote}/||"
    done | grep -vx HEAD | sort -u
)

for branch in "${branches[@]}"; do
    tips=()
    for remote in "${remotes[@]}"; do
        sha="$(git rev-parse -q --verify "refs/remotes/${remote}/${branch}")" && tips+=("$sha")
    done
    local_sha="$(git rev-parse -q --verify "refs/heads/${branch}")" || local_sha=""
    [ -n "$local_sha" ] && tips+=("$local_sha")

    if ! newest="$(newest_of "${tips[@]}")"; then
        warn "skipped ${branch}: diverged between remotes or from the local branch"
        problems=$((problems + 1))
        continue
    fi

    for remote in "${remotes[@]}"; do
        sha="$(git rev-parse -q --verify "refs/remotes/${remote}/${branch}")" || sha=""
        if [ "$sha" != "$newest" ]; then
            refspecs[$remote]+=" ${newest}:refs/heads/${branch}"
            echo "  ${branch} -> ${remote}$([ -z "$sha" ] && echo " (new)")"
        fi
    done

    if [ -n "$local_sha" ] && [ "$local_sha" != "$newest" ]; then
        if [ -n "$DRY_RUN" ]; then
            echo "  ${branch} -> local"
        elif [ "$branch" = "$current" ]; then
            git merge --quiet --ff-only "$newest" || { warn "could not fast-forward ${branch}"; problems=$((problems + 1)); }
            echo "  ${branch} -> local"
        elif grep -qxF "$branch" <<<"$checked_out"; then
            warn "local ${branch} is behind but checked out in another worktree; pull it there"
        else
            git update-ref "refs/heads/${branch}" "$newest" "$local_sha"
            echo "  ${branch} -> local"
        fi
    fi
done

dry_flag=()
[ -n "$DRY_RUN" ] && dry_flag=(--dry-run)

for remote in "${remotes[@]}"; do
    if [ -n "${refspecs[$remote]:-}" ]; then
        echo "Pushing branches to ${remote}"
        # shellcheck disable=SC2086 # one word per refspec
        git push --quiet "${dry_flag[@]}" "$remote" ${refspecs[$remote]} || { warn "push to ${remote} failed"; problems=$((problems + 1)); }
    fi
    if [ "$remote" != "$DEPLOY_REMOTE" ]; then
        git push --quiet "${dry_flag[@]}" --tags "$remote" || { warn "pushing tags to ${remote} failed"; problems=$((problems + 1)); }
    fi
done

if [ "$problems" -gt 0 ]; then
    fail "${problems} problem(s); see above"
fi
echo "All remotes in sync"

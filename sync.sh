#!/usr/bin/env bash
# Sync: bring every remote (origin on Gitea, github) up to date with the others.
# Usage: ./sync.sh [--dry-run]
# Fetches all remotes, then for each branch takes the newest tip found on any
# remote or locally and pushes it to every remote that is behind or lacks it.
# Pushes only fast-forward, so nothing on a remote is ever overwritten; a branch
# that has diverged is reported and left alone. Local branches that exist on a
# remote are fast-forwarded too; local-only branches are not pushed.
# After a run, the tip each branch was synced to is kept locally in refs/sync/.
# A branch that has since been deleted on one remote but is unchanged everywhere
# else (still at that tip) is deleted on the other remotes too; if it has new
# commits anywhere, it is restored instead and a warning is printed.
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
    # Branches first, on their own: what is pushed below is worked out from them, so a
    # failed fetch (no network, no access) must stop the run rather than push from stale refs.
    git fetch --quiet --prune --no-tags "$remote" || fail "could not fetch branches from ${remote}"
    # Tags separately: one that differs between remotes is refused (it is never moved
    # silently), which is worth a warning but leaves the branches to sync.
    git fetch --quiet --tags "$remote" || warn "some tags from ${remote} differ from local ones and were not fetched"
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
declare -A synced=()   # branch -> tip every remote holds after the pushes
declare -A removed=()  # branch -> 1 when it is being deleted everywhere
declare -A targets=()  # branch -> remotes it is pushed to (or deleted from)
declare -A failed=()   # remote -> 1 when a push to it failed
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

    # Gone from a remote since the last sync: delete it everywhere if nobody has
    # added to it since, otherwise restore it.
    record="$(git rev-parse -q --verify "refs/sync/${branch}")" || record=""
    missing=()
    unchanged=1
    for remote in "${remotes[@]}"; do
        sha="$(git rev-parse -q --verify "refs/remotes/${remote}/${branch}")" || sha=""
        if [ -z "$sha" ]; then
            missing+=("$remote")
        elif [ "$sha" != "$record" ]; then
            unchanged=""
        fi
    done
    if [ -n "$record" ] && [ "${#missing[@]}" -gt 0 ]; then
        if [ -n "$unchanged" ] && { [ -z "$local_sha" ] || [ "$local_sha" = "$record" ]; }; then
            for remote in "${remotes[@]}"; do
                git rev-parse -q --verify "refs/remotes/${remote}/${branch}" >/dev/null || continue
                refspecs[$remote]+=" :refs/heads/${branch}"
                targets[$branch]+=" ${remote}"
                echo "  ${branch} deleted on ${missing[*]} -> deleting on ${remote}"
            done
            removed[$branch]=1
            continue
        fi
        warn "${branch} was deleted on ${missing[*]} but has changed since the last sync; restoring it"
    fi

    if ! newest="$(newest_of "${tips[@]}")"; then
        warn "skipped ${branch}: diverged between remotes or from the local branch"
        problems=$((problems + 1))
        continue
    fi
    synced[$branch]="$newest"

    for remote in "${remotes[@]}"; do
        sha="$(git rev-parse -q --verify "refs/remotes/${remote}/${branch}")" || sha=""
        if [ "$sha" != "$newest" ]; then
            refspecs[$remote]+=" ${newest}:refs/heads/${branch}"
            targets[$branch]+=" ${remote}"
            echo "  ${branch} -> ${remote}$([ -z "$sha" ] && echo " (new)")"
        fi
    done

    if [ -n "$local_sha" ] && [ "$local_sha" != "$newest" ]; then
        if [ -n "$DRY_RUN" ]; then
            echo "  ${branch} -> local"
        elif [ "$branch" = "$current" ]; then
            if git merge --quiet --ff-only "$newest"; then
                echo "  ${branch} -> local"
            else
                warn "could not fast-forward ${branch}"
                problems=$((problems + 1))
            fi
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
        git push --quiet "${dry_flag[@]}" "$remote" ${refspecs[$remote]} || { warn "push to ${remote} failed"; failed[$remote]=1; problems=$((problems + 1)); }
    fi
    if [ "$remote" != "$DEPLOY_REMOTE" ]; then
        git push --quiet "${dry_flag[@]}" --tags "$remote" || { warn "pushing tags to ${remote} failed"; problems=$((problems + 1)); }
    fi
done

# Remember what each branch was synced to, so a later deletion can be told apart
# from a new branch. Branches whose push failed keep their old record.
pushed_ok() {
    local remote
    for remote in ${targets[$1]:-}; do
        [ -z "${failed[$remote]:-}" ] || return 1
    done
}
if [ -z "$DRY_RUN" ]; then
    for branch in "${!synced[@]}"; do
        pushed_ok "$branch" && git update-ref "refs/sync/${branch}" "${synced[$branch]}"
    done
    for branch in "${!removed[@]}"; do
        pushed_ok "$branch" && git update-ref -d "refs/sync/${branch}"
    done
    # Records of branches that are on no remote any more.
    while read -r ref; do
        grep -qxF "${ref#refs/sync/}" < <(printf '%s\n' "${branches[@]}") || git update-ref -d "$ref"
    done < <(git for-each-ref --format='%(refname)' refs/sync/)
fi

if [ "$problems" -gt 0 ]; then
    fail "${problems} problem(s); see above"
fi
echo "All remotes in sync"

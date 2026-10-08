#!/usr/bin/env bash
# Deploy: tag the current commit with the next version and push the tag. The push
# starts the Gitea Actions workflow (.gitea/workflows/deploy.yml); see DEPLOYMENT.md.
# Usage: ./deploy.sh
# Suggests the next version and the latest commit message; both can be edited
# before anything is created or pushed.
set -euo pipefail

cd "$(dirname "$0")"

fail() { echo "deploy: $*" >&2; exit 1; }

# Tags made on another machine would otherwise be missed, and the suggested
# version would already exist on the remote.
git fetch --quiet --tags origin || fail "could not fetch tags from origin"

latest="$(git tag --list 'v*' --sort=-v:refname | head -n 1)"
latest="${latest:-v0.0.0}"

# Each part counts to 9 and then carries, as the existing tags do: v1.0.9 -> v1.1.0.
next_version() {
    [[ "$1" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
    local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
    patch=$((patch + 1))
    if [ "$patch" -gt 9 ]; then patch=0; minor=$((minor + 1)); fi
    if [ "$minor" -gt 9 ]; then minor=0; major=$((major + 1)); fi
    echo "v${major}.${minor}.${patch}"
}
suggested="$(next_version "$latest")" || fail "latest tag ${latest} is not vX.Y.Z"
message="$(git log -1 --format=%s)"

echo "latest tag:  ${latest}"
echo "commit:      $(git log -1 --format='%h %s')"
if [ -n "$(git status --porcelain)" ]; then
    echo "warning:     uncommitted changes - they are not part of this deploy" >&2
fi
if git describe --exact-match --tags HEAD >/dev/null 2>&1; then
    echo "warning:     this commit is already tagged $(git describe --exact-match --tags HEAD)" >&2
fi
echo

read -r -e -p "version: " -i "$suggested" version
version="${version:-$suggested}"
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "not a vX.Y.Z version: ${version}"
git rev-parse --quiet --verify "refs/tags/${version}" >/dev/null && fail "tag ${version} already exists"

read -r -e -p "message: " -i "$message" answer
message="${answer:-$message}"

echo
read -r -p "Create ${version} (\"${message}\") and deploy? [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || { echo "deploy: cancelled"; exit 0; }

git tag -a "$version" -m "$message"
if ! git push origin "$version"; then
    git tag -d "$version" >/dev/null
    fail "push failed; the local tag ${version} was removed again"
fi
echo "deploy: pushed ${version} - the Deploy workflow is running now"

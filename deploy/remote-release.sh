#!/usr/bin/env bash
# Runs on the VPS, as the deploy user, from the directory the workflow uploads it
# into alongside compose.yaml. Pulls the image, pins it in .env, recreates the
# container and waits for its health check - and puts the previous tag back if
# the new one never passes.
#
#   remote-release.sh <tag> [image]
#
# The image defaults to the one already in .env, so rolling back by hand is:
#
#   bash /srv/some-assembly-required/remote-release.sh v1.0.0
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

env_file=".env"
keep=5
wait_seconds=90

fail() { echo "release: $*" >&2; exit 1; }

# The `|| true` is load-bearing. On the first deploy there is no .env yet; sed
# exits 2 on a file it cannot open, its message is swallowed by 2>/dev/null, and
# pipefail would propagate that 2 through the pipeline. With set -e the script
# would then die here, silently, before printing anything at all.
recorded() { { sed -n "s/^$1=//p" "$env_file" 2>/dev/null || true; } | tail -n 1; }

# Rewrites only the two lines this script owns; APP_PORT and anything else added
# by hand survives. Written beside and renamed over, so a full disk never leaves
# compose reading half a file.
pin() {
  {
    grep -vE '^APP_(IMAGE|TAG)=' "$env_file" 2>/dev/null || true
    echo "APP_IMAGE=$1"
    echo "APP_TAG=$2"
  } > "${env_file}.new"
  mv -f "${env_file}.new" "$env_file"
}

compose() { docker compose --project-directory "$here" "$@"; }

tag="${1:-}"
[ -n "$tag" ] || fail "usage: remote-release.sh <tag> [image]"
# The docker tag grammar. Checked here as well as in the workflow because this
# is also run by hand, and the value ends up in .env.
[[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || fail "not a valid image tag: ${tag}"

previous_image="$(recorded APP_IMAGE)"
previous_tag="$(recorded APP_TAG)"
image="${2:-$previous_image}"
[ -n "$image" ] || fail "no image given, and none recorded in ${here}/${env_file}"

# Pull before touching anything: a mistyped tag or an expired registry login
# fails here, with the old container still serving.
echo "release: pulling ${image}:${tag}"
docker pull --quiet "${image}:${tag}" >/dev/null || fail "could not pull ${image}:${tag}"

pin "$image" "$tag"
echo "release: starting ${tag}"
if ! compose up --detach --remove-orphans --wait --wait-timeout "$wait_seconds"; then
  compose logs --no-color --tail 30 >&2 || true
  if [ -n "$previous_tag" ] && [ "${previous_image}:${previous_tag}" != "${image}:${tag}" ]; then
    echo "release: ${tag} never became healthy, going back to ${previous_tag}" >&2
    pin "$previous_image" "$previous_tag"
    compose up --detach --remove-orphans --wait --wait-timeout "$wait_seconds" \
      || echo "release: ${previous_tag} did not come back healthy either" >&2
  fi
  fail "${tag} did not become healthy"
fi
echo "release: ${image}:${tag} is live"

# Keep the last few tags locally so a rollback does not have to wait on a pull.
docker image ls "$image" --format '{{.Tag}}' \
  | { grep -vxF -e "$tag" -e '<none>' -e latest || true; } \
  | tail -n "+${keep}" \
  | while read -r old; do
      docker image rm "${image}:${old}" >/dev/null 2>&1 && echo "release: pruned ${old}" || true
    done

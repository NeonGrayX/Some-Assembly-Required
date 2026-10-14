# The game server for a VPS: builds the client and the host executable, then ships only the
# executable. HTTPS is left to a reverse proxy in front of it (see DEPLOYMENT.md and deploy/).
FROM node:22-bookworm AS build
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /src
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY . .
# The client shows these in a corner of the main menu (client/vite.config.ts). .git is not
# copied in, so the release's tag and commit come from the same build args as below; left
# empty, the client says "dev".
ARG VERSION=
ARG COMMIT=
RUN SAR_VERSION="$VERSION" SAR_COMMIT="$COMMIT" npm run build && npm run build:host -w @sar/server \
  && cp release/some-assembly-required-host-linux-* /some-assembly-required-host

FROM debian:bookworm-slim
# curl is only for the health check.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /some-assembly-required-host /usr/local/bin/some-assembly-required-host

# Last, so a new tag does not invalidate the layers above. The server answers
# /build-info.json with this file; that is how a deploy is verified from outside.
ARG VERSION=
ARG COMMIT=
RUN printf '{\n  "app": "some-assembly-required",\n  "version": "%s",\n  "commit": "%s",\n  "builtAt": "%s"\n}\n' \
      "${VERSION:-dev}" "${COMMIT:-unknown}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /build-info.json

# The community page's shared builds. A volume mounted here starts out owned by the user below,
# since Docker copies the folder's owner into a new volume.
RUN install -d -o 65534 -g 65534 /data
USER 65534
ENV PORT=8080 SAR_BUILD_INFO=/build-info.json SAR_DATA_DIR=/data
EXPOSE 8080
# `docker compose up --wait` blocks on this, and the release rolls back if it never passes.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/build-info.json" || exit 1
CMD ["some-assembly-required-host", "--http", "--no-open"]

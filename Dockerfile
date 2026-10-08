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
RUN npm run build && npm run build:host -w @sar/server \
  && cp release/some-assembly-required-host-linux-* /some-assembly-required-host

FROM debian:bookworm-slim
# curl is only for the health check.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /some-assembly-required-host /usr/local/bin/some-assembly-required-host

# Last, so a new tag does not invalidate the layers above. The server answers
# /build-info.json with this file; that is how a deploy is verified from outside.
ARG VERSION=dev
ARG COMMIT=unknown
RUN printf '{\n  "app": "some-assembly-required",\n  "version": "%s",\n  "commit": "%s",\n  "builtAt": "%s"\n}\n' \
      "$VERSION" "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /build-info.json

USER 65534
ENV PORT=8080 SAR_BUILD_INFO=/build-info.json
EXPOSE 8080
# `docker compose up --wait` blocks on this, and the release rolls back if it never passes.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/build-info.json" || exit 1
CMD ["some-assembly-required-host", "--http", "--no-open"]

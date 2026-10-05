# The game server for a VPS: builds the client and the host executable, then ships only the
# executable. HTTPS is left to a reverse proxy in front of it (see deploy/).
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
COPY --from=build /some-assembly-required-host /usr/local/bin/some-assembly-required-host
USER 65534
ENV PORT=7777
EXPOSE 7777
CMD ["some-assembly-required-host", "--http", "--no-open"]

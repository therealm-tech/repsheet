# Builds the two images RepSheet ships: `api`, the Rust server, and `webapp`,
# the static front end served by nginx, which also proxies /api/ to the server.

FROM rust:1.98.1-alpine3.24@sha256:7cc1c22d77d9432f7fe012a70e6d3e555af54c2a6832700ed7d553f1769ae89f AS chef
RUN cargo install cargo-chef@0.1.78 --locked
WORKDIR /usr/local/src/repsheet

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY repsheet-api/ repsheet-api/
RUN cargo chef prepare --recipe-path recipe.json

# The recipe ignores the package version, so a release bump keeps the cooked
# dependency layer cached.
FROM chef AS api-builder
COPY --from=planner /usr/local/src/repsheet/recipe.json recipe.json
RUN cargo chef cook --release --locked --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY repsheet-api/ repsheet-api/
RUN cargo build --release --locked --bin repsheet-api

FROM node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS webapp-builder
WORKDIR /usr/local/src/repsheet
COPY repsheet-webapp/package.json repsheet-webapp/package-lock.json ./
RUN npm ci
COPY repsheet-webapp/ ./
RUN npm run build

# musl links statically: the binary needs no libc, only the CA roots and the
# nonroot user (65532) the distroless image provides.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88 AS api
COPY --from=api-builder /usr/local/src/repsheet/target/release/repsheet-api /usr/local/bin/repsheet-api
USER 65532:65532
EXPOSE 3000
HEALTHCHECK CMD ["/usr/local/bin/repsheet-api", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/repsheet-api"]
CMD ["serve"]

FROM nginx:1.31.7-alpine3.24@sha256:892bb2152464f0c5d8972593a5f5afaf8054552580b699d95f8ff4af08c2d33d AS webapp
# The nginx image lags behind Alpine's security updates: these two upgrades
# clear CVE-2026-77214 (libexpat) and CVE-2026-88806 (libx11) until a newer
# nginx image ships them.
RUN apk add --no-cache libexpat=2.9.0-r0 libx11=1.8.14-r0 \
    && addgroup -g 65532 -S repsheet \
    && adduser -u 65532 -S -D -H -h /nonexistent -s /sbin/nologin -G repsheet repsheet \
    && rm /etc/nginx/conf.d/default.conf \
    && chown repsheet:repsheet /var/cache/nginx /etc/nginx/conf.d
COPY repsheet-webapp/nginx/nginx.conf /etc/nginx/nginx.conf
COPY repsheet-webapp/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=webapp-builder /usr/local/src/repsheet/dist /usr/share/nginx/html
ENV API_HOST=api:3000
USER 65532:65532
EXPOSE 8080
HEALTHCHECK CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]

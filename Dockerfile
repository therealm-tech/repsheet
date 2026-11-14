# Builds the two images RepSheet ships: `api`, the Rust server, and `webapp`,
# the static front end served by nginx, which also proxies /api/ to the server.

FROM rust:1.99.1-alpine3.24@sha256:44819b27be4c97b0e4d7203bd2e02c4820f97700211b6a37fb4c246a2de59383 AS chef
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

FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS webapp-builder
WORKDIR /usr/local/src/repsheet
COPY repsheet-webapp/package.json repsheet-webapp/package-lock.json ./
RUN npm ci
COPY repsheet-webapp/ ./
RUN npm run build

# musl links statically: the binary needs no libc, only the CA roots and the
# nonroot user (65532) the distroless image provides.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:aafe993665bf6200db38a02c11a9351e782a84b6a45e7f33b6695638c88e3931 AS api
COPY --from=api-builder /usr/local/src/repsheet/target/release/repsheet-api /usr/local/bin/repsheet-api
USER 65532:65532
EXPOSE 3000
HEALTHCHECK CMD ["/usr/local/bin/repsheet-api", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/repsheet-api"]
CMD ["serve"]

FROM nginx:1.31.8-alpine3.24@sha256:713fc2ebfd92e8217db451477182ee91944b123d2b1ee9fd5a8c6e91ca6c3a11 AS webapp
# The base ships libxslt 1.1.43-r3 (CVE-2026-87636, CVE-2026-9947, HIGH), which fails the Trivy
# image scan. Remove this upgrade once the base ships r4: Alpine keeps only the latest revision,
# so the pin breaks the build as soon as a newer one is published.
RUN apk add --no-cache libxslt=1.1.43-r4 \
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

# Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/therealm-tech/repsheet). In
short: install the hooks, keep `pre-commit` and the tests green, and update the docs in the same pull
request as the code.

## Development setup

The repository holds two projects: the Rust API in [repsheet-api/](repsheet-api/) and the React
webapp in [repsheet-webapp/](repsheet-webapp/). See [README.md](README.md#getting-started) for
running the whole stack with Docker.

Tooling:

- **Rust** through [rustup](https://rustup.rs): the toolchain and its components are pinned in
  [rust-toolchain.toml](rust-toolchain.toml) and installed on first use.
- **Node.js** at the version in [repsheet-webapp/.nvmrc](repsheet-webapp/.nvmrc), with npm.
- **Docker** with Compose v2, for PostgreSQL.
- **pre-commit**, plus the binaries its local hooks call: `hadolint`, `trivy` and `shellcheck`.
- **cargo-edit** (`cargo set-version`), to cut releases.

```sh
uv tool install pre-commit
```

```sh
cargo install cargo-edit
```

**macOS**

```sh
brew install hadolint trivy shellcheck
```

**Linux**: install [hadolint](https://github.com/hadolint/hadolint#install),
[Trivy](https://trivy.dev/latest/getting-started/installation/) and
[ShellCheck](https://github.com/koalaman/shellcheck#installing) from their upstream instructions.

Then, from a fresh clone:

```sh
pre-commit install
```

```sh
npm ci --prefix repsheet-webapp
```

```sh
docker compose up -d postgres
```

Run the API (port 3100) and the webapp dev server (port 5173, proxying `/api` to the API) in two
terminals:

```sh
cargo run -p repsheet-api -- serve
```

```sh
npm run dev --prefix repsheet-webapp
```

[.cargo/config.toml](.cargo/config.toml) gives `cargo run` and `cargo test` the database URL, the
listen address and the super admin credentials of this local stack; a variable set in your
environment takes precedence.

## Running the tests

The API tests need the Compose PostgreSQL running (`docker compose up -d postgres`): each
integration test gets a fresh database through `#[sqlx::test]`.

```sh
cargo test
```

```sh
npm test --prefix repsheet-webapp
```

A subset:

```sh
cargo test --test api logs_blocks_in_a_workout
```

```sh
npm test --prefix repsheet-webapp -- block-sheet
```

- **API unit tests** live next to the code (`#[cfg(test)]` modules) and need nothing.
- **API integration tests** in [repsheet-api/tests/](repsheet-api/tests/) drive the HTTP router
  against PostgreSQL.
- **Webapp tests** (Vitest and Testing Library) live in
  [repsheet-webapp/src/\_\_tests\_\_/](repsheet-webapp/src/__tests__/) and run in jsdom.

A new behaviour comes with tests, and a fix with a test that fails without it.

## Pre-commit hooks

The hooks in [.pre-commit-config.yaml](.pre-commit-config.yaml) must pass before a commit is pushed.

```sh
pre-commit run --all-files
```

```sh
pre-commit run cargo-clippy --all-files
```

| Hook | Checks | Fix |
| --- | --- | --- |
| `trailing-whitespace`, `end-of-file-fixer` | whitespace | fixes itself; re-stage |
| `check-yaml`, `check-toml`, `check-json` | files parse | fix the syntax |
| `check-added-large-files`, `check-merge-conflict`, `detect-private-key` | accidental content | remove it |
| `yamllint` | YAML style ([.yamllint.yaml](.yamllint.yaml)) | block style, no `---` |
| `hadolint`, `trivy-dockerfile` | the [Dockerfile](Dockerfile) | fix the finding |
| `actionlint` | GitHub workflows | fix the workflow |
| `sqlfluff-lint` | migrations and queries ([.sqlfluff](.sqlfluff)) | `sqlfluff fix <file>` |
| `shellcheck` | shell scripts | fix the finding |
| `cargo-fmt` | Rust formatting | fixes itself; re-stage |
| `cargo-clippy` | Rust lints, `pedantic` included, warnings are errors | fix the code |
| `biome-check` | webapp formatting and lints | fixes what it can; fix the rest |
| `tsc` | webapp type checking | fix the types |
| `no-co-authors` | commit message has no co-author or "generated with" line | rewrite the message |

`--no-verify` and `SKIP=` are not the fix: a red hook is a real finding. If a rule is wrong for this
repository, change its configuration in the same pull request and say why. CI runs the same hooks.

## Continuous integration

| Workflow | Triggers on | What it does | Reproduce locally |
| --- | --- | --- | --- |
| [quality](.github/workflows/quality.yaml) | every PR, `main` | `pre-commit run --all-files`, API tests against PostgreSQL, webapp tests | `pre-commit run --all-files`, then the test commands above |
| [build](.github/workflows/build.yaml) | PRs and `main` touching the images' inputs, manual | builds both images on native `amd64` and `arm64` runners, Trivy-scans them, pushes only when asked | `docker build --target api .` and `--target webapp`, then `trivy image` |
| [security](.github/workflows/security.yaml) | every PR, `main`, daily, manual | `trivy fs` on the lockfiles and secrets; daily, `trivy image` on the latest released images | `trivy fs .` |
| [release](.github/workflows/release.yaml) | tag `v*` | checks the tag matches the committed version, publishes the images, creates the GitHub release (not for `-rc` tags) | — |

`quality` and `security` are the required checks; `build` is path-filtered and informational.
Publishing uses the workflow's own `GITHUB_TOKEN` (`packages: write` on the release only), so no
secret has to be configured. Dependabot opens weekly updates for Cargo, npm, Docker images and
GitHub Actions ([.github/dependabot.yaml](.github/dependabot.yaml)).

## Submitting a change

- Commit subjects are short, imperative and lowercase, with an optional `area:` prefix (`api:`,
  `webapp:`, `ci:`, `docker:`); follow `git log --oneline`.
- A pull request is green on CI, updates the documentation it affects, and carries one of the
  labels listed in [.github/release.yaml](.github/release.yaml) so it lands in the right section of
  the release notes.

## Releasing

Releases are cut from an up-to-date `main` with [scripts/release.sh](scripts/release.sh), the only
supported way: it bumps the Cargo workspace and the webapp, commits, tags `vX.Y.Z`, then asks before
pushing.

```sh
scripts/release.sh 0.2.0
```

Pushing the tag runs the `release` workflow, which publishes the images and the GitHub release.

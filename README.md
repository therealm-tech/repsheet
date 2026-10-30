<p align="center">
  <img src="repsheet-webapp/public/logo.svg" alt="RepSheet logo: a barbell whose plates are drawn as orange pixel squares" width="240">
</p>

# RepSheet

A web app to log strength-training workouts set by set, from your phone, once the session is over.

## Description

RepSheet records what you actually did at the gym: each workout is a sequence of **blocks**, a block
is one exercise (simple), two alternated exercises (superset) or three or more in rotation
(circuit), and each block holds the **sets** of every round. An exercise is counted in reps, time or
distance — some either way, like a crunch done for reps or for a minute, chosen block by block — and
carries a weight when it takes one. The weight can change from one set to the next, never within a
set.

It is built for someone who trains with a coach: a session can follow a **template** written from the
coach's plan, or be logged freely when the coach improvises. A workout is dated with the day it took
place on and is usually filled in after the session, though nothing prevents completing it block by
block during it. Each set is pre-filled from the template's target, the previous round or the
performance of the workout before, so that logging a session takes a few minutes.

- Built-in catalog of common exercises, plus your own
- Progression per exercise and per mode: max weight, most reps or longest set over time, records,
  full history (warm-up sets excluded)
- Templates built by hand or from a workout you already logged
- Multi-user: anyone can sign up; each account only sees its own data
- A super admin, configured on the server, manages the accounts and the built-in catalog
- In French and English, interface and catalog alike; the language is a preference of the account

RepSheet does not plan training or generate programs, and it has no timer: the coach runs the
session, RepSheet keeps the record.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and the reasoning behind it.

## Getting started

### Prerequisites

- Docker with Compose v2

### Installation

```sh
git clone https://github.com/therealm-tech/repsheet.git
```

```sh
cd repsheet
```

### Configuration

The stack runs as two images. The **API** (`repsheet-api`) is configured through the environment;
each variable also exists as a command-line flag (`repsheet-api serve --help`).

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | PostgreSQL connection string, e.g. `postgres://user:password@host:5432/repsheet` |
| `SUPER_ADMIN_EMAIL` | yes | — | Email of the super admin account |
| `SUPER_ADMIN_PASSWORD` | yes | — | Password of the super admin account, at least 8 characters |
| `BIND_ADDR` | no | `0.0.0.0:3000` | Address the HTTP server listens on |
| `DB_MAX_CONNECTIONS` | no | `10` | Size of the database connection pool |
| `TOKEN_TTL_DAYS` | no | `30` | Lifetime of a login token, in days |
| `LOG_FILTER` | no | `info` | [`tracing` filter directive](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html#directives), e.g. `repsheet_api=debug` |
| `LOG_FORMAT` | no | `text` | `text` or `json` |

On start-up, the API applies its database migrations, then creates the super admin account, or
gives it back the configured password and the super admin role if it already exists. Super admins
can promote other accounts.

The **webapp** image (`repsheet-webapp`) serves the front end on port 8080 and forwards `/api/` to
the API:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `API_HOST` | no | `api:3000` | `host:port` of the API, as reachable from the webapp container |

### Usage

Build and start PostgreSQL, the API and the webapp:

```sh
docker compose --profile app up -d --build
```

Then open <http://localhost:8100> on your phone or in a browser, create an account and start a
workout. The super admin of this local stack is set in
[docker-compose.yaml](docker-compose.yaml). The API reference is served at <http://localhost:8100/api/docs>, and the OpenAPI document
at `/api/openapi.json`.

Stop everything with:

```sh
docker compose --profile app down
```

### Deployment

Each release `vX.Y.Z` publishes both images to GitHub Container Registry, for `amd64` and `arm64`,
tagged `X.Y.Z`, `X.Y` and `X`: `ghcr.io/therealm-tech/repsheet-api` and
`ghcr.io/therealm-tech/repsheet-webapp`. The available versions are listed on the
[releases page](https://github.com/therealm-tech/repsheet/releases).

Run the API with `DATABASE_URL` pointing at a PostgreSQL 18 database, and the webapp with `API_HOST`
pointing at the API. Put TLS in front of the webapp: tokens travel in an `Authorization` header.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

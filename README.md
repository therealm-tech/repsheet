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
carries a weight when it takes one. Likewise, an exercise done with a barbell or with dumbbells is one
exercise, and each block says which; so is a row done with a pronated or a supinated grip. The weight
can change from one set to the next, never within a set.

It is built for someone who trains with a coach: a session can follow a **template** written from the
coach's plan, or be logged freely when the coach improvises. A workout is dated with the day it took
place on and is usually filled in after the session, though nothing prevents completing it block by
block during it. Each set is pre-filled from the sets your coach planned, the template's target,
the previous round or the performance of the workout before, so that logging a session takes a few
minutes. A template gives each exercise your instructions, shown while logging it, and each logged
exercise carries a thread of comments, yours and your coaches', kept in its history; a coach's note
on a planned exercise starts that thread.

- Built-in catalog of common exercises, plus your own, which a filter lists on their own
- Personal labels on any exercise (your programme, a body part, your gym's equipment), shown on
  the exercise list and used to filter it, there and while building a block; nobody else sees them
- Progression per exercise, mode, equipment and grip: max weight, most reps or longest set over
  time, records, full history (warm-up sets excluded)
- Templates built by hand or from a workout you already logged
- Coaching: add your coaches' accounts; each plans sessions for you on given days, set by set and
  load by load, from your last time, and sends them once ready; they see how each one went, plus the
  other workouts you choose to share with them, and comment on their exercises; remove a coach and
  their access ends at once, while the sessions and comments stay yours; as a coach, an Athletes tab
  lists the people you coach, each with the next session planned for them
- Athletes without an account: a coach creates a profile with just a name and a unit, plans its
  sessions, logs them on the athlete's behalf against the athlete's own history, or sends one as
  text through the phone's share sheet; a one-time invitation link later turns the profile into the
  athlete's account, history included, or the coach merges it into the account of an athlete who
  already added them
- Multi-user: anyone can sign up; each account only sees its own data, plus, as a coach, the
  sessions it planned and the workouts shared with it
- A super admin, configured on the server, manages the accounts and the built-in catalog
- In French and English, interface and catalog alike; the language is a preference of the account

RepSheet does not generate programs, and it has no timer: the coach runs the session, RepSheet
keeps the record.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and the reasoning behind it.

## Getting started

### Prerequisites

- Docker with Compose v2
- To deploy on Kubernetes: a cluster, `kubectl` and Helm ≥ 3.8

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
workout. Served over HTTPS, or from `localhost`, the webapp installs as an app: "Add to Home
Screen" on a phone, the install button of the address bar in a desktop browser. The super admin of
this local stack is set in [docker-compose.yaml](docker-compose.yaml). The API reference is served at <http://localhost:8100/api/docs>, and the OpenAPI document
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

On Kubernetes, install the Helm chart, published to the same registry as
`oci://ghcr.io/therealm-tech/charts/repsheet`. It deploys both images against an existing PostgreSQL
database. Keep the database URL and the super admin password in a Secret:

```sh
kubectl create namespace repsheet
```

```sh
kubectl create secret generic repsheet --namespace repsheet \
  --from-literal=DATABASE_URL='postgres://repsheet:<password>@<host>:5432/repsheet' \
  --from-literal=SUPER_ADMIN_PASSWORD='<password>'
```

```sh
helm install repsheet oci://ghcr.io/therealm-tech/charts/repsheet --version 0.3.0 \
  --namespace repsheet \
  --set api.database.existingSecret.name=repsheet \
  --set api.superAdmin.existingSecret.name=repsheet \
  --set api.superAdmin.email=admin@example.com
```

Expose the webapp with `ingress.enabled` or `httpRoute.enabled`. Every value is listed in the
[chart's README](charts/repsheet/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

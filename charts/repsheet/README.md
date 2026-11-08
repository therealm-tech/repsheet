# repsheet

![Version: 0.2.0](https://img.shields.io/badge/Version-0.2.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.2.0](https://img.shields.io/badge/AppVersion-0.2.0-informational?style=flat-square)

RepSheet, a web app to log strength-training workouts set by set. Deploys the API and the webapp against an external PostgreSQL database.

The chart runs the API and the webapp as two Deployments, each with its own Service and
ServiceAccount, and routes traffic to the webapp through an optional Ingress or Gateway API
HTTPRoute. PostgreSQL is not part of it: the API connects to the database named by `api.database`.

It is published to GitHub Container Registry as `oci://ghcr.io/therealm-tech/charts/repsheet`. The
install commands are in the [RepSheet README](https://github.com/therealm-tech/repsheet#deployment),
and the application's design in its [ARCHITECTURE.md](https://github.com/therealm-tech/repsheet/blob/main/ARCHITECTURE.md).

## Configuration

- The API requires `api.database`, `api.superAdmin.email` and `api.superAdmin`'s password. Each
  secret comes either inline, stored in a Secret the chart generates, or from a Secret you manage
  (`existingSecret.name`, and `existingSecret.key` when its entry is named differently).
- Values under `global` apply to both components. Each can be overridden for one component by
  setting the same key under `api` or `webapp`, e.g. `api.replicaCount`.
- Both containers run as UID 65532 with a read-only root filesystem. The webapp mounts `emptyDir`
  volumes on `/etc/nginx/conf.d`, where its entrypoint renders the nginx configuration, and on
  `/tmp`, for nginx's pid and temporary files.
- Put TLS in front of the webapp, at the Ingress or the Gateway: tokens travel in an
  `Authorization` header.

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| api | object | See its keys below. | The HTTP API (`repsheet-api`). It owns the database schema and applies its migrations on start-up. |
| api.caCerts | object | `{"existing":{"key":"ca-certificates.crt","kind":"ConfigMap","name":null},"inline":null}` | Extra CA certificates to trust for the database connection, on top of the built-in public roots; supply only your private CA. Used when the connection string sets `sslmode=verify-ca` or `verify-full`. |
| api.caCerts.existing | object | `{"key":"ca-certificates.crt","kind":"ConfigMap","name":null}` | Mount the PEM bundle from a resource you already manage, instead of `inline`. |
| api.caCerts.existing.key | string | `"ca-certificates.crt"` | Key in the resource holding the PEM bundle (also the mounted file name). |
| api.caCerts.existing.kind | string | `"ConfigMap"` | Kind of the resource: `ConfigMap` or `Secret`. |
| api.caCerts.existing.name | string | `nil` | Name of the resource. Set → mounts from it instead of generating a Secret from `inline`. |
| api.caCerts.inline | string | `nil` | Inline PEM bundle. Stored in a Secret and mounted. Ignored when `existing.name` is set. |
| api.database | object | `{"existingSecret":{"key":"DATABASE_URL","name":null},"maxConnections":10,"url":null}` | PostgreSQL connection. The database is external: the chart only hands its URL to the API. |
| api.database.existingSecret | object | `{"key":"DATABASE_URL","name":null}` | Read the connection string from a Secret you manage instead of `url`. |
| api.database.existingSecret.key | string | `"DATABASE_URL"` | Key in that Secret holding the connection string. |
| api.database.existingSecret.name | string | `nil` | Name of the Secret. Set → takes precedence over `url`. |
| api.database.maxConnections | int | `10` | Size of the connection pool of each replica (`DB_MAX_CONNECTIONS`); the database must accept `replicaCount` times this many connections. |
| api.database.url | string | `nil` | Connection string, e.g. `postgres://user:password@host:5432/repsheet`. Stored in a generated Secret. Ignored when `existingSecret.name` is set. |
| api.image | object | `{"repository":"ghcr.io/therealm-tech/repsheet-api"}` | Image of the API. |
| api.image.repository | string | `"ghcr.io/therealm-tech/repsheet-api"` | Image repository of the API. |
| api.log | object | `{"filter":"info","format":"text"}` | Logging of the API. |
| api.log.filter | string | `"info"` | `tracing` filter directive (`LOG_FILTER`), e.g. `repsheet_api=debug`. |
| api.log.format | string | `"text"` | Log format (`LOG_FORMAT`): `text` or `json`. |
| api.resources | object | `{"limits":{"ephemeral-storage":"256Mi","memory":"256Mi"},"requests":{"cpu":"50m","ephemeral-storage":"64Mi","memory":"64Mi"}}` | Resources of the API container. Hashing a password takes about 19 MiB, once per concurrent login. |
| api.resources.limits | object | `{"ephemeral-storage":"256Mi","memory":"256Mi"}` | Resource caps; CPU is deliberately left unlimited. |
| api.resources.limits.ephemeral-storage | string | `"256Mi"` | Ephemeral storage cap. |
| api.resources.limits.memory | string | `"256Mi"` | Memory cap. |
| api.resources.requests | object | `{"cpu":"50m","ephemeral-storage":"64Mi","memory":"64Mi"}` | Resources reserved for the container. |
| api.resources.requests.cpu | string | `"50m"` | CPU reserved. |
| api.resources.requests.ephemeral-storage | string | `"64Mi"` | Ephemeral storage reserved. |
| api.resources.requests.memory | string | `"64Mi"` | Memory reserved. |
| api.service | object | `{"port":3000}` | Service in front of the API, reached by the webapp. |
| api.service.port | int | `3000` | Port of the Service. |
| api.serviceAccount | object | `{"name":null}` | ServiceAccount of the API. |
| api.serviceAccount.name | string | `nil` | Name of the ServiceAccount. Unset → `<fullname>-api`. |
| api.superAdmin | object | `{"email":null,"existingSecret":{"key":"SUPER_ADMIN_PASSWORD","name":null},"password":null}` | Super admin account, created or restored on every start-up. |
| api.superAdmin.email | string | `nil` | Email of the super admin account (`SUPER_ADMIN_EMAIL`). Required. |
| api.superAdmin.existingSecret | object | `{"key":"SUPER_ADMIN_PASSWORD","name":null}` | Read the password from a Secret you manage instead of `password`. |
| api.superAdmin.existingSecret.key | string | `"SUPER_ADMIN_PASSWORD"` | Key in that Secret holding the password. |
| api.superAdmin.existingSecret.name | string | `nil` | Name of the Secret. Set → takes precedence over `password`. |
| api.superAdmin.password | string | `nil` | Password of the super admin account, at least 8 characters. Stored in a generated Secret. Ignored when `existingSecret.name` is set. |
| api.tokenTtlDays | int | `30` | Lifetime of a login token, in days (`TOKEN_TTL_DAYS`). |
| global | object | See its keys below. | Values shared by the `api` and `webapp` components. Any key below but `fullnameOverride` can be overridden for one component by setting it under `api:` or `webapp:`, e.g. `api.replicaCount`. |
| global.affinity | object | `{}` | Affinity rules of the pods. |
| global.extraEnv | list | `[]` | Extra environment variables added to the containers. |
| global.extraVolumeMounts | list | `[]` | Extra volume mounts added to the containers. |
| global.extraVolumes | list | `[]` | Extra volumes added to the pods. |
| global.fullnameOverride | string | `nil` | Overrides the name the chart's objects are prefixed with. Unset → `<release>-repsheet`, or `<release>` when the release name already contains `repsheet`. |
| global.image | object | `{"pullPolicy":"IfNotPresent","tag":null}` | Container image settings; each component sets its own `image.repository`. |
| global.image.pullPolicy | string | `"IfNotPresent"` | Kubernetes image pull policy. |
| global.image.tag | string | `nil` | Image tag. Unset → the chart's `appVersion`, so both images match the chart's release. |
| global.imagePullSecrets | list | `[]` | Secrets used to pull the images, as `- name: <secret>`. The published images are public. |
| global.livenessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/healthz","port":"http"},"periodSeconds":10}` | Probe restarting a container that stops answering. |
| global.livenessProbe.failureThreshold | int | `3` | Failed probes tolerated before the container is restarted. |
| global.livenessProbe.httpGet | object | `{"path":"/healthz","port":"http"}` | HTTP request the probe sends. |
| global.livenessProbe.httpGet.path | string | `"/healthz"` | Path of the health endpoint. |
| global.livenessProbe.httpGet.port | string | `"http"` | Named container port probed. |
| global.livenessProbe.periodSeconds | int | `10` | Seconds between two probes. |
| global.nodeSelector | object | `{}` | Node labels the pods must run on. |
| global.podAnnotations | object | `{}` | Annotations added to every pod. |
| global.podLabels | object | `{}` | Labels added to every pod. |
| global.podSecurityContext | object | `{"fsGroup":65532,"runAsGroup":65532,"runAsNonRoot":true,"runAsUser":65532,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod-level security context; loosening it breaks the restricted Pod Security Standard. |
| global.podSecurityContext.fsGroup | int | `65532` | GID that owns the mounted volumes. |
| global.podSecurityContext.runAsGroup | int | `65532` | Primary GID the containers run as. |
| global.podSecurityContext.runAsNonRoot | bool | `true` | Refuse to start a container whose image runs as UID 0. |
| global.podSecurityContext.runAsUser | int | `65532` | UID the containers run as: the `nonroot` user both images are built with. |
| global.podSecurityContext.seccompProfile | object | `{"type":"RuntimeDefault"}` | Seccomp profile applied to the pods. |
| global.podSecurityContext.seccompProfile.type | string | `"RuntimeDefault"` | Seccomp profile type. |
| global.readinessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/healthz","port":"http"},"periodSeconds":5}` | Probe taking a pod out of its Service while it does not answer. |
| global.readinessProbe.failureThreshold | int | `3` | Failed probes tolerated before the pod is marked unready. |
| global.readinessProbe.httpGet | object | `{"path":"/healthz","port":"http"}` | HTTP request the probe sends. |
| global.readinessProbe.httpGet.path | string | `"/healthz"` | Path of the health endpoint. |
| global.readinessProbe.httpGet.port | string | `"http"` | Named container port probed. |
| global.readinessProbe.periodSeconds | int | `5` | Seconds between two probes. |
| global.replicaCount | int | `1` | Number of pods per component. The API is stateless and migrates the database under a lock, so it can run several replicas. |
| global.revisionHistoryLimit | int | `0` | Number of old ReplicaSets each Deployment keeps for rollback. |
| global.securityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}` | Container-level security context; loosening it breaks the restricted Pod Security Standard. |
| global.securityContext.allowPrivilegeEscalation | bool | `false` | Forbid gaining more privileges than the parent process. |
| global.securityContext.capabilities | object | `{"drop":["ALL"]}` | Linux capabilities. |
| global.securityContext.capabilities.drop | list | `["ALL"]` | Capabilities removed from the containers. |
| global.securityContext.readOnlyRootFilesystem | bool | `true` | Mount the image read-only; the webapp gets `emptyDir` volumes where nginx writes. |
| global.service | object | `{"type":"ClusterIP"}` | Service settings; each component sets its own `service.port`. |
| global.service.type | string | `"ClusterIP"` | Kubernetes Service type. |
| global.serviceAccount | object | `{"annotations":{},"create":true}` | ServiceAccount settings; each component gets its own ServiceAccount. |
| global.serviceAccount.annotations | object | `{}` | Annotations added to the ServiceAccounts. |
| global.serviceAccount.create | bool | `true` | Create a ServiceAccount per component. `false` → pods use `serviceAccount.name`, or the namespace's `default`. |
| global.startupProbe | object | `{"failureThreshold":60,"httpGet":{"path":"/healthz","port":"http"},"periodSeconds":2}` | Probe holding back liveness and readiness until the server answers; the API applies its migrations first. |
| global.startupProbe.failureThreshold | int | `60` | Failed probes tolerated before the container is restarted. |
| global.startupProbe.httpGet | object | `{"path":"/healthz","port":"http"}` | HTTP request the probe sends. |
| global.startupProbe.httpGet.path | string | `"/healthz"` | Path of the health endpoint. |
| global.startupProbe.httpGet.port | string | `"http"` | Named container port probed. |
| global.startupProbe.periodSeconds | int | `2` | Seconds between two probes. |
| global.tolerations | list | `[]` | Tolerations of the pods. |
| httpRoute | object | See its keys below. | Gateway API HTTPRoute routing every path to the webapp Service. The chart only creates the route; the Gateway is managed outside it. |
| httpRoute.annotations | object | `{}` | Annotations of the HTTPRoute. |
| httpRoute.enabled | bool | `false` | Create the HTTPRoute. |
| httpRoute.gateway | object | `{"name":null,"namespace":null,"sectionName":null}` | Gateway the route attaches to. |
| httpRoute.gateway.name | string | `nil` | Name of the Gateway. Required when the HTTPRoute is enabled. |
| httpRoute.gateway.namespace | string | `nil` | Namespace of the Gateway. Unset → the release namespace. |
| httpRoute.gateway.sectionName | string | `nil` | Listener of the Gateway to attach to. Unset → every listener that accepts the route. |
| httpRoute.hostnames | list | `[]` | Host names matched, e.g. `- repsheet.example.com`. Empty → the Gateway listener's host names. |
| ingress | object | See its keys below. | Ingress routing every path to the webapp Service. Put TLS in front of the webapp: tokens travel in an `Authorization` header. |
| ingress.annotations | object | `{}` | Annotations of the Ingress, e.g. for cert-manager. |
| ingress.className | string | `nil` | IngressClass of the Ingress. Unset → the cluster's default class. |
| ingress.enabled | bool | `false` | Create the Ingress. |
| ingress.hosts | list | `[]` | Host names served, e.g. `- repsheet.example.com`. Empty → every host. |
| ingress.tls | list | `[]` | TLS settings, as `- secretName: <secret>` with its `hosts`. |
| webapp | object | See its keys below. | The webapp (`repsheet-webapp`): nginx serving the front end and proxying `/api/` to the API Service. |
| webapp.image | object | `{"repository":"ghcr.io/therealm-tech/repsheet-webapp"}` | Image of the webapp. |
| webapp.image.repository | string | `"ghcr.io/therealm-tech/repsheet-webapp"` | Image repository of the webapp. |
| webapp.resources | object | `{"limits":{"ephemeral-storage":"256Mi","memory":"128Mi"},"requests":{"cpu":"10m","ephemeral-storage":"64Mi","memory":"32Mi"}}` | Resources of the webapp container. Its `emptyDir` volumes count against the ephemeral storage. |
| webapp.resources.limits | object | `{"ephemeral-storage":"256Mi","memory":"128Mi"}` | Resource caps; CPU is deliberately left unlimited. |
| webapp.resources.limits.ephemeral-storage | string | `"256Mi"` | Ephemeral storage cap. |
| webapp.resources.limits.memory | string | `"128Mi"` | Memory cap. |
| webapp.resources.requests | object | `{"cpu":"10m","ephemeral-storage":"64Mi","memory":"32Mi"}` | Resources reserved for the container. |
| webapp.resources.requests.cpu | string | `"10m"` | CPU reserved. |
| webapp.resources.requests.ephemeral-storage | string | `"64Mi"` | Ephemeral storage reserved. |
| webapp.resources.requests.memory | string | `"32Mi"` | Memory reserved. |
| webapp.service | object | `{"port":8080}` | Service in front of the webapp, the one the Ingress and the HTTPRoute point at. |
| webapp.service.port | int | `8080` | Port of the Service. |
| webapp.serviceAccount | object | `{"name":null}` | ServiceAccount of the webapp. |
| webapp.serviceAccount.name | string | `nil` | Name of the ServiceAccount. Unset → `<fullname>-webapp`. |

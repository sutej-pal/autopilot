# Folder structure

pnpm workspaces, Node 20+, TypeScript everywhere. Packages beyond the original list are included because more than one process needs the same schema, crypto, and browser interpreter. They are part of this design; reject them before Phase 1 if you want them folded into `apps/api` instead.

```text
apps/
  web/                 Next.js + React. Auth.js. No Playwright.
  api/                 Fastify. Auth verification, CRUD, vault, WebSocket gateway,
                       run grants, signed artifact URLs.
  recorder/            Playwright entrypoint: screencast + capture. Same image as worker.
  worker/              Playwright entrypoint: replay. Heartbeats to the API.
  scheduler/           Materialize slots, claim due runs, enqueue BullMQ.
  watchdog/            Overdue and stuck runs, outbox dispatcher, dead-man checks.
packages/
  shared/              Workflow Zod schema, variable renderer, error types, cron preview.
  db/                  Drizzle schema, migrations, RLS SQL.
  crypto/              Envelope encryption helpers. KMS behind an interface.
                       LocalKey for dev, KmsKey for AWS.
  mail/                MailProvider interface, SES implementation, redacted templates.
  browser/             Locator fallback, replay interpreter, capture script, masking.
infra/
  cdk/                 Added in Phase 5. VPC, ECS, RDS, Redis, S3, KMS, SES, alarms.
docs/
  phase-0/             This design.
docker/
  browser.Dockerfile   Non-root Chromium image used by recorder and worker.
  egress.Dockerfile    Forward proxy with a public-internet allow policy.
```

## Dependency direction

`apps/*` may depend on `packages/*`. Packages do not depend on apps. `packages/browser` may depend on `packages/shared`. It does not talk to Postgres or AWS. `packages/mail` does not import Playwright.

The recorder and worker processes call the API over HTTP with a run grant. They do not import `packages/db` or `packages/crypto`.

## Local Phase 1 process model

```text
docker compose
  postgres
  redis
  egress
  api
  recorder      (profile, started per session; compose service is the image)
  worker
  web
```

Scheduler, watchdog, Auth.js, RLS, KMS, and SES are not required to demonstrate record-and-replay in Phase 1. The schema in `packages/db` should still include the later tables so Phase 3 does not reshape Phase 1 data. Tables can exist before services write them.

## Image constraints for browser tasks

- Non-root user. Chromium runs as a different uid from the small Node supervisor.
- Read-only root filesystem, tmp as a size-capped tmpfs.
- No Docker socket, no host mounts, no AWS credentials in the environment.
- CPU and memory limits: recorder 1 vCPU / 2 GB, worker 2 vCPU / 4 GB, to be revised after Phase 1 measures a real portal.
- Dropped capabilities, `no-new-privileges`, pid limit.
- Egress only to the API (security group) and to the egress proxy. The proxy drops destinations in `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, and IPv6 unique-local and link-local ranges.

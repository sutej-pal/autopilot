# Data model

Postgres is the source of truth for workflows, slots, runs, and notifications. Redis holds only BullMQ job payloads and short-lived locks. If Redis is empty, the watchdog and scheduler can reconstruct work from Postgres.

Tenant column on every tenant-owned table is `org_id`. Request code sets `app.tenant_id` for the transaction. Policies are `org_id = current_setting('app.tenant_id')::uuid`. A table without `org_id` is either global reference data or a service table the request role cannot read.

## Identity

```text
organizations
  id                uuid pk
  name              text
  wrapped_dek       bytea          -- AES data key wrapped by KMS
  kms_key_id        text
  created_at        timestamptz

users
  id                uuid pk
  email             text unique
  password_hash     text null      -- argon2id; null for Google-only
  name              text
  timezone          text not null default 'Asia/Kolkata'
  email_status      text not null default 'ok'  -- ok | bounced | complained
  created_at        timestamptz

memberships
  org_id            uuid references organizations
  user_id           uuid references users
  role              text not null  -- owner | member
  primary key (org_id, user_id)
```

Auth.js tables (`accounts`, `sessions`, `verification_tokens`) live in the same database. They are not tenant data. The session carries `userId` and `activeOrgId`.

Owners manage members, credentials, and schedules. Members can record, edit, and run workflows in the org. A member cannot read the vault plaintext; neither can an owner after save. Both can replace a credential.

## Workflow

```text
workflows
  id                     uuid pk
  org_id                 uuid not null
  name                   text not null
  start_url              text not null
  timezone               text not null
  definition             jsonb not null   -- variables + steps, see below
  storage_state_cipher   bytea null       -- AES-256-GCM, includes nonce
  storage_state_kid      int not null default 1
  screenshots_enabled    boolean not null default true
  status                 text not null    -- draft | active | paused
  created_by             uuid
  created_at             timestamptz
  updated_at             timestamptz

workflow_revisions
  id            uuid pk
  org_id        uuid not null
  workflow_id   uuid not null
  revision      int not null
  definition    jsonb not null
  created_by    uuid
  created_at    timestamptz
  unique (workflow_id, revision)

credentials
  id            uuid pk
  org_id        uuid not null
  workflow_id   uuid null          -- null = org-level vault entry
  name          text not null      -- username | password | totp | custom
  cipher        bytea not null
  kid           int not null
  created_at    timestamptz
  unique (org_id, workflow_id, name)
```

There is no plaintext credential column. Logs, traces, and API responses must not add one.

`definition` matches the product JSON, without embedding the schedule (the schedule is relational so constraints are enforceable):

```json
{
  "variables": [{ "name": "hours", "type": "string", "default": "8" }],
  "steps": [
    { "id": "s1", "type": "goto", "url": "https://portal.example/timesheet" },
    {
      "id": "s2",
      "type": "fill",
      "description": "Fill username",
      "framePath": [],
      "locators": [
        { "strategy": "role", "role": "textbox", "name": "Email" },
        { "strategy": "label", "text": "Email" },
        { "strategy": "testid", "value": "email" },
        { "strategy": "css", "value": "#email" }
      ],
      "value": "{{credentials.username}}"
    },
    {
      "id": "s5",
      "type": "click",
      "description": "Click Submit timesheet",
      "commit": true,
      "locators": []
    },
    {
      "id": "s6",
      "type": "assert",
      "description": "Timesheet submitted",
      "locators": [],
      "expect": { "textContains": "Timesheet submitted" }
    }
  ]
}
```

Locator strategies, tried in order: `role`, `label`, `placeholder`, `text`, `testid`, `id`, `name`, `css`, `xpath`. `framePath` is the iframe chain (frame URL or frame name, nearest first) and is resolved before the locators.

Step types in v1 of the schema: `goto`, `click`, `dblclick`, `fill`, `select`, `press`, `assert`, `guard`, `upload`, `dialog`. `pick-date` is reserved and rejected by the parser until Phase 5. `upload` steps with `needsFile: true` fail the run with a clear error until a file is attached.

`commit: true` marks the first mutating step (usually the submit click). The recorder defaults this to the last click; the editor can move it. Retry rules depend on it.

`guard` is the idempotency pre-check. If its assertion fails closed as "already done" (`onFail: "already-done"`), the run ends `succeeded` with outcome `already-satisfied` and does not send a failure email.

Built-in templates:

| Template | Resolution |
| --- | --- |
| `{{today}}` | Workflow-local date, `YYYY-MM-DD` |
| `{{today\|FORMAT}}` | Same instant, allow-listed format tokens only |
| `{{now}}` | ISO-8601 in the workflow zone |
| `{{weekday}}` | English weekday name in the workflow zone |
| `{{credentials.username}}` | Vault |
| `{{credentials.password}}` | Vault, never persisted in `definition` |
| `{{credentials.totp}}` | Generated at use from the stored TOTP secret |
| `{{hours}}` | User variable |

Format strings are not passed to a general template engine. Unknown tokens fail the step.

## Schedule and runs

```text
schedules
  id                         uuid pk
  org_id                     uuid not null
  workflow_id                uuid not null unique
  cron                       text not null
  timezone                   text not null
  enabled                    boolean not null default true
  catch_up                   text not null    -- skip | within_minutes | always
  catch_up_minutes           int not null default 120
  max_duration_seconds       int not null default 600
  retries                    int not null default 1
  notify_emails              text[] not null
  notify_on_failure          boolean not null default true
  notify_on_success          boolean not null default false
  notify_on_missed           boolean not null default true
  collapse_window_minutes    int not null default 60
  daily_summary              boolean not null default false

runs
  id               uuid pk
  org_id           uuid not null
  workflow_id      uuid not null
  schedule_id      uuid null
  scheduled_for    timestamptz null     -- null for manual runs
  trigger          text not null        -- manual | schedule | catchup | watchdog
  status           text not null
  outcome          text null            -- verified | already-satisfied | null
  failure_type     text null
  revision         int not null         -- workflow_revisions.revision used
  created_at       timestamptz
  terminal_at      timestamptz null

run_attempts
  id               uuid pk
  org_id           uuid not null
  run_id           uuid not null
  attempt          int not null
  status           text not null        -- running | succeeded | failed
  worker_id        text null
  heartbeat_at     timestamptz null
  started_at       timestamptz
  finished_at      timestamptz null
  error_type       text null
  error_message    text null            -- short, redacted
  commit_reached   boolean not null default false
  unique (run_id, attempt)

step_results
  id               uuid pk
  org_id           uuid not null
  attempt_id       uuid not null
  step_id          text not null
  status           text not null        -- passed | healed | failed | skipped
  locator_index    int null             -- 0 = primary; >0 = healed
  error_message    text null
  screenshot_key   text null
  started_at       timestamptz
  finished_at      timestamptz
```

Run status values: `scheduled`, `queued`, `running`, `succeeded`, `failed`, `needs_login`, `missed`, `skipped`, `cancelled`.

Constraints:

```sql
-- One slot per workflow instant. Manual runs have a null scheduled_for
-- and are not covered by this index.
create unique index runs_one_slot
  on runs (workflow_id, scheduled_for)
  where scheduled_for is not null;

-- Overlap protection. A second active run cannot be inserted or updated in.
create unique index runs_one_active
  on runs (workflow_id)
  where status in ('queued', 'running');
```

`skipped` means catch-up policy declined to execute a late slot. `missed` means a slot should have run (`always`, or `within_minutes` and inside the window, or the job never started) and the watchdog or scheduler closed it as not executed. Both are non-success. `skipped` emails only when `notify_on_missed` is true. `missed` always creates a failure notification when failure notifications are on.

## Notifications

```text
notifications
  id                  uuid pk
  org_id              uuid not null
  run_id              uuid null
  workflow_id         uuid null
  type                text not null     -- run_failed | run_succeeded | run_missed | daily_summary | test
  idempotency_key     text not null unique
  status              text not null     -- queued | sending | sent | collapsed | bounced | complained | dead
  collapsed_into      uuid null
  to_addresses        text[] not null
  subject             text not null
  text_body           text not null
  html_body           text not null
  attempts            int not null default 0
  next_attempt_at     timestamptz not null
  provider_message_id text null
  last_error          text null
  created_at          timestamptz
  sent_at             timestamptz null

notification_events
  id                  uuid pk
  notification_id     uuid not null
  provider_event      text not null     -- delivery | bounce | complaint
  payload             jsonb not null    -- provider payload with addresses only
  created_at          timestamptz
```

`idempotency_key` for a run failure is `run_failed:{runId}`. A retry of the dispatcher cannot insert a second row. Extra channels later (webhook, Telegram) use a different type suffix (`run_failed:{runId}:webhook`) and the same outbox.

The insert of `notifications` happens in the same transaction as the update that sets `runs.status` to a terminal non-success state, and only after business retries are exhausted. Attempt failures do not insert a notification.

## Sessions, artifacts, audit, quotas

```text
browser_sessions
  id            uuid pk
  org_id        uuid not null
  workflow_id   uuid null
  kind          text not null          -- record | relogin | watch
  status        text not null
  task_arn      text null
  expires_at    timestamptz not null

audit_log
  id            uuid pk
  org_id        uuid not null
  actor_id      uuid null
  action        text not null
  target        text not null
  metadata      jsonb not null         -- no secrets
  created_at    timestamptz

org_quotas
  org_id                 uuid pk
  workflows_limit        int not null default 25
  runs_per_day           int not null default 100
  concurrent_runs        int not null default 2
  max_duration_seconds   int not null default 1800
```

S3 keys are stored on `step_results.screenshot_key` and, when video is enabled, on the attempt. Bucket policy denies any principal except the API task role and a scoped grant minted per run. Default lifecycle expiration is 30 days. `screenshots_enabled = false` skips capture and the email omits the screenshot link.

## Row-level security

Every table above that has `org_id` gets an `org_isolation` policy for the `app_user` role. `app_user` has no `BYPASSRLS`. The API opens a transaction, runs `select set_config('app.tenant_id', $1, true)`, then queries.

`app_worker_broker` is a second role used only by scheduler, watchdog, and the internal broker endpoints. It is not granted to recorder or worker tasks, because those tasks have no database connection.

Force RLS on the table owner as well, so a mistaken superuser-style app connection still filters. Migrations run as an owner role that is not the application role.

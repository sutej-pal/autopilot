# Email and reliability

A missed schedule or a silent failure is the failure this design is built to avoid. The path that sends email does not run inside the worker that just crashed.

## What "never miss" means

For every enabled schedule occurrence:

- A `runs` row exists for that `(workflow_id, scheduled_for)`, even if the decision is to skip it.
- The row ends in a terminal status: `succeeded`, `failed`, `needs_login`, `missed`, `skipped`, or `cancelled`.
- If the terminal status is not `succeeded` or `cancelled`, and failure notifications are on, one `notifications` row exists for that run.
- None of this depends on a particular scheduler task, worker task, or Redis staying up for the whole day.

`succeeded` with outcome `already-satisfied` (the idempotency guard saw that today's entry exists) is success. It does not email unless success email is on.

## Slot materialization

Scheduler tasks, minimum two, run the same loop every 15 seconds.

```text
begin;
select id from schedules
  where enabled
  order by id
  for update skip locked
  limit 20;
-- expand cron in the schedule timezone from now to now+24h
insert into runs (..., status = 'scheduled', trigger = 'schedule')
  values (...)
  on conflict (workflow_id, scheduled_for) where scheduled_for is not null
  do nothing;
commit;
```

Cron is interpreted as wall time in `schedules.timezone`. The stored `scheduled_for` is the UTC instant. A fall-back DST hour can produce two instants; both are valid slots. A spring-forward gap produces no slot. The library that expands cron must be timezone-aware (`luxon` together with a cron parser). This behavior has not been executed yet.

## Claiming work

```text
begin;
select id from runs
  where status = 'scheduled'
    and scheduled_for <= now()
  order by scheduled_for
  for update skip locked
  limit 20;
-- apply catch-up
-- apply per-org concurrency cap
-- respect runs_one_active
update runs set status = 'queued', trigger = ... where id = ...;
commit;
-- then
bullmq.add(jobId = runId + ':' + attempt)
```

Catch-up, evaluated when `now` is after `scheduled_for`:

| Policy | Inside the window | Past the window |
| --- | --- | --- |
| `within_minutes` (default 120) | `queued`, `trigger = catchup` | `skipped` if we never started; notification if `notify_on_missed` |
| `always` | `queued`, `trigger = catchup` | same, no expiry |
| `skip` | `skipped` | `skipped` |

A skip is still a row. The occurrence is not forgotten.

If the queue add fails after the row is `queued`, the next scheduler tick treats `queued` plus "no active BullMQ job and no heartbeat" as needing another add of the same job id. BullMQ dedupes on job id, so a duplicate add is safe.

## Workers

- Queue: `runs`. Job id: `{runId}:{attempt}`.
- The worker heartbeats every 10 seconds by calling the API, which updates `run_attempts.heartbeat_at`.
- BullMQ stall interval: 60 seconds. That redelivers the job if the process is killed.
- On redelivery the handler reads the attempt. A fresh heartbeat means another worker is alive and this delivery exits. A dead heartbeat before `commit_reached` starts the next business attempt if retries remain. A dead heartbeat after `commit_reached` does **not** click submit again unless the guard proves the write is absent.
- Business retry count lives on `schedules.retries` (default 1). It is not `Job.opts.attempts`.
- Each attempt uses a new browser context and the saved `storageState`. It replays from step 1. That is safe only because of the commit rule above. A timesheet retry without a guard can double-submit; the editor must say so when no guard and no commit flag exist.
- Overlap: the partial unique index on active runs is the backstop. The claim query also checks `org_quotas.concurrent_runs`.

Per-tenant fairness: the claim limits how many `queued`/`running` runs an org already has. A tenant with a full cap is left `scheduled` or `queued` for a later tick. Scale-out does not override the cap.

## Watchdog

`apps/watchdog` is a separate ECS service, minimum two tasks, deployed separately from the worker and the scheduler. It uses Postgres only. It does not consume BullMQ. If the broken component is the worker, the scheduler, or Redis, the watchdog still runs.

Every minute, with `SKIP LOCKED` so the two tasks do not double-close a row:

| Condition | Action |
| --- | --- |
| `running` attempt whose heartbeat is older than 90 seconds, and retries remain, and commit was not reached | Enqueue the next attempt |
| Same, but retries are exhausted or commit was reached and the guard cannot clear a retry | Mark run `failed`, failure type `lost-heartbeat`, insert notification |
| `running` longer than `max_duration_seconds` | Mark `failed`, failure type `max-duration`, insert notification |
| `queued` for more than 2 minutes with no heartbeat and no requeue in progress | Ask scheduler logic to re-add, or mark `failed` with `queue-lost` if that fails twice |
| Enabled cron occurrence in the last 6 hours with no `runs` row | Insert the row as `missed`, failure type `never-materialized`, insert notification |
| `scheduled` row past the catch-up window | Apply the same skip/miss transition the scheduler would |

The notification insert is in the same transaction as the status change. Closing a row that already has a `run_failed:{runId}` key is a no-op on the notification.

The watchdog also dispatches the outbox (below). Detection and delivery share a process class so a dead worker cannot take email with it. Two watchdog tasks provide the same protection against a dead watchdog.

## Failure types that email

One outbox row after retries are exhausted, for any of:

- failed step or failed assertion
- step timeout or navigation error
- `needs-login` (session expired, MFA, SSO, CAPTCHA)
- worker crash, OOM, lost heartbeat
- missed slot, or a slot that was never materialized
- max duration exceeded
- scheduler or queue error that left the slot unqueued (`queue-lost`, `never-materialized`)

`skipped` by catch-up uses type `run_missed` and honors `notify_on_missed` (default true). `cancelled` by a person does not email.

The body states the attempt count. Subjects use the workflow timezone:

```text
[AutoPilot] Failed: Daily timesheet (12 Oct 2026, 6:00 PM IST)
```

Body, plain text and HTML, mobile-width table not required but the HTML is a single column:

- workflow name
- scheduled time in the user timezone
- failure type in plain language
- failing step description, for example `Click "Submit timesheet"`
- short error, redacted
- attempts used
- whether the run was a catch-up
- links: run page (requires login), screenshot (signed URL, expiry 24 hours, omitted if screenshots are disabled or masking failed — if masking fails, do not upload the image and do not link it), Run now, Re-login when the type is `needs-login`, Pause schedule

Those action links open the app and require a session. They are not bearer tokens that perform the action by themselves. A forwarded email cannot pause a schedule without the recipient logging in.

The screenshot URL is the one unauthenticated link, and it points at a masked image. If the mask step did not run, there is no link.

The message must not contain credential values, cookies, `storageState`, or a dump of the page. Templates escape workflow names so a name cannot inject HTML.

## Outbox dispatcher

The dispatcher polls:

```text
select ... from notifications
  where status = 'queued' and next_attempt_at <= now()
  order by created_at
  for update skip locked
  limit 20
```

Then it applies the collapse window. If another notification for the same workflow was sent, or is being sent, inside `collapse_window_minutes`, this row is marked `collapsed`, `collapsed_into` points at the one that will send, and the outbound body gains a line `Failing for N days` / `N failures in this window`. The collapsed rows remain for the audit log and for the "exactly one row per run" test.

Rows that are not collapsed are sent through `MailProvider`.

```text
interface MailProvider {
  send(message: { to: string[]; subject: string; text: string; html: string; idempotencyKey: string }): Promise<{ providerMessageId: string }>;
}
```

Phase 3 implements `SesMailProvider`. A `LogMailProvider` (or Mailhog) is allowed in local development. The interface is the only swap point for Resend or Postmark.

Send retries: exponential backoff, 1 minute, 5 minutes, 15 minutes, 1 hour, 4 hours, then `dead`. A dead letter increments a CloudWatch metric. An alarm fires when the dead or failed-send count is above zero for 15 minutes. That alarm is the internal page; it is not the user email.

`idempotencyKey` is also passed to SES as the message tag or the configuration-set identifier we store, so a dispatcher crash after SES accepts the message but before we mark `sent` can be reconciled from the SES event. Until that event arrives, a resend is possible. The practical mitigation is: set `status = sending` with a lease before the API call, and only a lease expiry can send again. A duplicate in that window is the accepted residual risk; the unique key prevents a duplicate **row**, not a duplicate SMTP handoff if we crash mid-call. This limit should be stated in the runbook rather than denied.

## SES

- A dedicated subdomain, for example `mail.example.com`, not the apex.
- Easy DKIM, SPF on the mail-from subdomain, DMARC starting at `p=none` with a report address, then `p=quarantine` once reports look clean. Do not start at `p=reject` before mail actually flows.
- A configuration set publishes delivery, bounce, and complaint events to SNS, then to an API webhook.
- The webhook updates `notification_events` and, on a hard bounce or complaint, sets `users.email_status`. Further sends to that address stop. The app shows a banner. If the workflow has another address in `notify_emails` that has not bounced, the dispatcher uses it. If every address is dead, the in-app notifications log is the only channel, and the watchdog raises an internal alarm (`user-undeliverable`) so the failure is still not silent to operators.
- Production SES access is a launch task. Until it is granted, the account is in the sandbox and will refuse arbitrary recipients. Phase 3 tests must use a verified mailbox and must not claim production delivery.

## Flood control vs the test plan

The test plan requires one queued notification per failed run, no second row on retry, and no failure email on success. Collapse can still produce **one SES send covering several runs**. Tests that say "delivered" should assert on outbox rows first, and assert on provider sends only when the collapse window is disabled. That split is intentional.

Success notifications are a separate type (`run_succeeded`) and default off.

A daily summary, if enabled, is one `daily_summary` row per org per local day, written by the watchdog. It is not a substitute for per-failure mail.

## Overlap, guards, and double submit

Default editor behavior for a new recording:

- The last `click` is marked `commit: true`.
- The user is asked to add a guard such as "today's timesheet row is absent" before that click.
- If they save without a guard, the workflow is runnable, retries stay at 1, but a failure on or after the commit step does not auto-retry. The email says the run was not retried because the submit may have landed.

This is stricter than "always retry once". Blind retry of a timesheet submit is worse than a single failure email.

For the timesheet portal described by the user, a second create on the same date adds hours (8 then 8 becomes 16). The guard is not optional for that workflow. If an entry for the date is already present, the run stops as `already-satisfied` and does not click submit. Changing the hours afterward is a different recording that edits the existing entry to an absolute value. Replaying the create flow would inflate the total.

## Autoscaling and alarms (plan, built in Phase 3–5)

- Worker service scales on a custom metric: BullMQ jobs in `waiting` plus jobs `queued` in Postgres older than 30 seconds. Scale-in only drains tasks with no active run.
- Minimum worker count can be 0 in a cost-sensitive environment. Cold start then adds a minute or more before the run starts. The watchdog's "queued too long" threshold must sit above cold start, or a scale-from-zero event looks like a lost job. The cost doc assumes a minimum of 1 for that reason.
- Alarms: queue age, worker error rate, notification `dead` count, watchdog loop not reporting a heartbeat metric, SES bounce rate. The watchdog publishes its own heartbeat metric. If that metric is missing, CloudWatch alarms. That is the alarm for "the thing that sends alarms about runs is down."

## Internal alerting

PagerDuty (or the equivalent you choose in Phase 5) receives the CloudWatch alarms above. User failure email and operator paging are different paths. A noisy tenant workflow pages nobody. A dead outbox pages an operator.

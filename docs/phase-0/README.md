# AutoPilot — Phase 0 (design only)

Phase 0 is a design. Nothing in this folder has been implemented, deployed, or executed. Replay, email delivery, schedule catch-up, and tenant isolation are specified here and are **unverified** until the phase that builds them actually runs those tests.

| Doc | What it decides |
| --- | --- |
| [Assumptions](./00-assumptions.md) | Defaults used so the design can be reviewed before the portal is known |
| [Architecture](./01-architecture.md) | Services, trust boundaries, record / run / schedule flows |
| [Data model](./02-data-model.md) | Postgres tables, constraints, workflow JSON |
| [Folder structure](./03-folder-structure.md) | Monorepo layout and what each package owns |
| [Recorder streaming](./04-recorder-streaming.md) | CDP screencast vs noVNC, and the capture pipeline |
| [Email and reliability](./05-email-and-reliability.md) | Outbox, SES, watchdog, catch-up, retries |
| [Threat model](./06-threat-model.md) | Assets, abuse cases, controls, accepted risks |
| [Cost estimate](./07-cost-estimate.md) | Idle monthly floor and marginal cost per run |
| [Test plan](./08-test-plan.md) | Tests required before calling a later phase done |
| [Open questions](./09-open-questions.md) | What is still unknown after the portal answers |
| [Timesheet portal](./10-portal-timesheet.md) | Public site, email/password, datepicker, additive hours |

## How to review

Read the docs in the table order. There is no server to start. The decisions that most affect later phases:

1. Remote browser video is **CDP screencast**, not VNC.
2. Schedules are rows in Postgres. Redis is a work queue, not the source of truth.
3. A failure email is inserted in the **same transaction** that marks the run failed. A separate watchdog dispatches it and also detects dead workers.
4. Recorder and worker containers do **not** receive database or KMS credentials.
5. Browser traffic leaves through an **egress proxy** that refuses private, link-local, and metadata addresses.

## Phase gate

The portal questions are answered well enough to start Phase 1 against a public demo and a local fixture. A run against the real timesheet waits on the URL and on a `pick-date` step. See [open questions](./09-open-questions.md).

# Test plan

No tests exist yet. This is the contract later phases have to meet before they are called done. A test that has not been run is a failing test, not a passing one.

Phase 1 can automate only the replay section. Reliability, email, and isolation wait until the services they need exist (Phases 2 and 3). Do not stub an email assertion in Phase 1 and describe it as covered.

## Replay (Phase 1)

- Record a flow on a public demo page, save workflow JSON, replay it, and assert the success check passes. This is a real browser test, not a unit test of the JSON.
- Break the first locator (change the role name in the saved JSON) so the second locator matches. The step result is `healed`, and the run still succeeds.
- A password typed during recording does not appear in the workflow JSON, in the step panel model, or in a log line captured during the test. It does appear as `{{credentials.password}}`.
- A date field filled with today's date is stored as a `{{today|…}}` template, and replay writes the new day's value when the clock is fixed to another date.
- An assertion with the wrong expected text fails the run. The step result stores the failing step id and description.

## Reliability (Phase 3)

Use a short cron (every minute) in a test timezone, not a mock of the scheduler loop alone. Kill processes at the OS or container level.

| Kill | Required outcome |
| --- | --- |
| Worker process during a run, before the commit step | The run completes on retry, or ends `failed` with a notification row. It does not stay `running` |
| Worker process after the commit step | No second submit. The run ends `failed` or `succeeded`/`already-satisfied` based on the guard. One notification only if it did not succeed |
| One scheduler task, others left up | The next slot still materializes and runs |
| All schedulers down across a scheduled instant, then restored inside the catch-up window | Policy `within_minutes`: one catch-up run. Policy `skip`: one `skipped` row. Policy `always`: one run. Never zero rows |
| Redis flushed while a slot is due | Watchdog or scheduler recreates the queue job from the `runs` row, or marks the run failed and writes the outbox. The slot is not left `scheduled` forever |

Overlap: two "run now" calls at once produce one active run. The other is rejected or waits. Two rows in `queued`/`running` for the same workflow must be impossible (database constraint test).

## Email (Phase 3)

For each trigger, with collapse disabled so sends are 1:1 with rows:

- failed assertion
- step timeout
- worker killed and retries exhausted
- scheduler absent across the slot (missed or caught up; email only if the terminal state is not success)
- expired session (`needs-login`)
- slot never materialized (watchdog gap)

Assertions:

- Exactly one `notifications` row with that run's idempotency key.
- A second dispatcher pass does not insert or send another.
- A successful run with default settings inserts no `run_failed` row.
- The rendered subject and both bodies do not contain the fixture password, the TOTP seed, a cookie, or `storageState`.
- The screenshot object, if linked, has the password field masked. If the test cannot show masking, the email must not contain a link. Do not wave this through on a text assertion alone; open the image.

Provider: Mailhog or the SES mailbox you verify. "Queued" is not "delivered". The Phase 3 note must say which of the two was observed.

## Isolation (Phase 2)

Two organizations, two users. As user A, attempt to read and write B's workflow, credential ciphertext, `storageState`, run, notification, and artifact URL (including a guessed S3 key). All of these fail. Repeat with the database role used by the API, not the migration owner, so RLS is actually in the path.

## Definition of done, mapped

| Product promise | Proof |
| --- | --- |
| Record a timesheet, run it, verified success, today's date | Phase 1 demo on the real portal, then kept as a regression only if the portal allows automated login in CI. Otherwise a fixture site in CI and a manually logged portal run before launch |
| Weekday 6:00 PM schedule survives a dead worker or scheduler | Phase 3 chaos tests above, plus one wall-clock run you actually wait for |
| One failure email even if the worker crashes | Watchdog test, with the provider mailbox checked |
| Healed locator | Phase 1 selector test |

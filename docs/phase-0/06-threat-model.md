# Threat model

This is a design-time threat model. No control listed here has been implemented or tested. Severity is about the hosted multi-tenant system, not about Phase 1's single local tenant.

## Assets

| Asset | Why it matters |
| --- | --- |
| Vault credentials and TOTP seeds | Replay logs into the customer's portal |
| `storageState` | A saved session is often as good as the password |
| Workflow definitions | Business process, sometimes internal URLs |
| Run artifacts | Screenshots can contain salaries, names, ticket text |
| Notification contents | Must stay useful without becoming a second copy of the secret |
| One tenant's rows | Must be unreadable to another tenant |
| AWS task credentials | A stolen task role becomes an S3 or KMS incident |
| The schedule itself | Silent skip is the product failure |

## Actors

- A signed-in member of a tenant, including a malicious one.
- A signed-in owner.
- An outsider with no account.
- A malicious or compromised website the user records (the site sees a real browser and can attack it).
- Another tenant on the same platform.
- An operator with cloud access. Operators are trusted to run the platform and are not trusted with a UI that displays vault plaintext. They can still reach ciphertext and KMS if they hold those IAM rights; that is an accepted operator risk, reduced by KMS grants and audit, not eliminated.

## Trust boundaries

See the table in [architecture](./01-architecture.md). The boundaries that carry the most risk are: request path to Postgres, browser task to the cloud metadata service, and email to the public internet.

## Abuse cases and controls

| ID | Case | Outcome if uncontrolled | Design control | Residual risk |
| --- | --- | --- | --- | --- |
| T1 | Change `org_id` on a request and read another tenant's workflow, vault, session, runs, or notifications | Cross-tenant data breach | `org_id` on every table, RLS forced for `app_user`, integration test with two orgs | A service-role bug that uses the broker role from a request handler bypasses RLS. Code review plus a lint that request handlers use only `app_user` |
| T2 | Stolen database backup | All ciphertext exposed | Per-tenant data key, AES-256-GCM, data key wrapped by a CMK in KMS. Snapshots are not enough without `kms:Decrypt` | An attacker who has both the snapshot and a role that can decrypt has everything. IAM for decrypt is limited to the API task role |
| T3 | Password written into workflow JSON, logs, traces, or email | Secret leaves the vault | Password path never assigns the raw value onto a step. Traces disabled for credential steps. Email templates have no secret fields. Log redaction for the templates `{{credentials.*}}` | A site that echoes the password into visible text will still screenshot it unless the mask list includes that node. Masking failures must drop the artifact |
| T4 | SSRF from a recorded URL or from a page the browser loads, aimed at `169.254.169.254` or `169.254.170.2` | Task role credentials stolen, then S3 and KMS | Chromium uid cannot reach those ranges. All browser egress goes through a proxy that denies private, loopback, link-local, and metadata ranges. Task role on recorder and worker is empty of S3 and KMS | Proxy bypass (a bug that lets Chromium dial directly) restores the risk. Security groups should also block metadata from the task subnet's browser path as defense in depth. This control is easy to get wrong and must be tested by attempting the request |
| T5 | Container escape from a hostile page, via a Chromium bug | Code execution in the task | Ephemeral task, non-root, separate uid for Chromium, read-only root, no host mounts, no Docker socket, dropped caps, cpu/memory/pid limits, destroyed after the session. The task holds only that run's secrets | A full escape of a task that already holds this run's password and `storageState` exposes that run. It must not expose other tenants. That is why the task has no database and no KMS |
| T6 | User points a workflow at an internal admin URL or at a cloud metadata host by name | Scan or attack of internal services | The same egress proxy, plus an optional per-org domain allow/deny list, plus a platform denylist | DNS rebinding: a public name that later resolves to a private address. The proxy must check the resolved IP at connect time, not only the hostname string |
| T7 | WebSocket to a recorder session guessed or stolen | Drive someone else's logged-in browser | Session cookie plus a per-session token bound to `org_id` and `browser_sessions.id`. Tokens are single-use to open the socket and expire with the session | A stolen user session cookie is still a full account compromise, which is outside the recorder-specific control |
| T8 | Email HTML injection via workflow name, or an action link that pauses a schedule without login | Phish a user, or let a forwarded email change the account | Escape HTML. Action links only navigate to authenticated app routes. Screenshot URLs are time-limited and point at masked objects | The screenshot link is a bearer URL for 24 hours. Anyone who has the email has the image. Users who disable screenshots avoid this |
| T9 | Bounce or complaint storm, or email to an address the user does not own | SES reputation, mailbox spam | Double confirmation is not in v1 for the account email (they signed up with it). Extra recipient addresses should get an opt-in confirmation before use. SES configuration set, suppression on hard bounce and complaint, account banner | Opt-in for extra recipients is specified here and is easy to "temporarily" skip. Do not skip it |
| T10 | One tenant enqueues enough runs to starve others | Availability | Per-org concurrency and daily run quotas, queue fair claim, rate limits on record and run | Quotas set too high. Defaults in [data model](./02-data-model.md) are a starting point, not a measured capacity |
| T11 | Schedule slot double-fired, or lost when a task dies | Double timesheet submit, or a silent miss | Unique `(workflow_id, scheduled_for)`, partial unique index on active runs, `SKIP LOCKED`, outbox, watchdog | Bugs in the catch-up window math. Covered by the reliability tests, which do not exist yet |
| T12 | Retry after a submit that actually succeeded | Duplicate timesheet | Commit flag, no retry after commit unless the guard shows the entry is absent | Users who delete the guard and also mark every step as non-commit. The editor copy has to make the default safe |
| T13 | Member escalates to owner, or edits a workflow they should not | Account takeover inside the org | Role checks on member management, credential replace, and schedule pause. Audit log | A stolen owner session. Standard session fixation and cookie flags (`Secure`, `HttpOnly`, `SameSite=Lax`) |
| T14 | Artifact URL for tenant A used from tenant B's prefix | Cross-tenant screenshots | Keys are `org/{orgId}/...`. Presigns are minted by the API after an RLS read of the step result. The browser task receives a prefix-scoped upload, not a bucket role | A bug that presigns a caller-supplied key. The API must derive the key from the row, not from the request body |
| T15 | Operator or log pipeline collects a secret | Quiet leak | No secret in logs by construction. Review the recorder's step payload in tests | Future debug logging. Add a test that fails if a known secret string appears in log fixtures |
| T16 | Hostile workflow as a general-purpose browser bot (fraud, credential stuffing) | Platform used as an attack tool | Quotas, domain denylist, rate limits, Terms of Use, audit log, ability to suspend an org | This does not stop a determined abuser of a small number of public sites. Suspension is manual in v1 |
| T17 | User automates a portal that forbids bots, or a portal they do not have an account on | Legal and account risk for the user and, potentially, the platform | Terms say they must be allowed to automate the site. Product does not provide CAPTCHA bypass | Residual legal risk sits with counsel, not with this design |
| T18 | Watchdog and scheduler share a bug and both skip the same slot | Silent miss, the worst case | Watchdog recomputes recent cron occurrences independently and inserts `missed` if no row exists. Different query, same database | A bad cron library used by both services reproduces the bug. Prefer one well-tested expander, and a watchdog check that is "is there a row", not "re-decide the cron" only. The missing-row check does not need to re-parse if the scheduler writes an intended-slot table. Phase 3 should add `schedule_occurrences` written at materialize time so the watchdog looks for gaps in a table rather than re-implementing cron. **This is a refinement of the brief's "slots live in `runs`"**: `runs` remains the unique slot, and the watchdog's gap scan is the safety net |

T18 is called out because it changes an implementation detail: the scheduler should record the occurrence it intended, and the watchdog should look for intended occurrences that never became terminal. Re-parsing cron in two services is how a timezone bug fails open.

## Encryption

- One CMK per environment. Each organization has a 256-bit data key. The stored form is the KMS-wrapped key (`organizations.wrapped_dek`).
- Credentials and `storageState` use AES-256-GCM with a random nonce stored beside the ciphertext. AAD includes `org_id` and the row id so ciphertext cannot be moved between rows.
- Decrypt happens in the API process, in memory, for the duration of a grant. The grant handed to a worker contains the session and the credential values for that run and an expiry of minutes. It is not written to the workflow row.
- Local development uses `LocalKey` from an env var. That mode must refuse to start if `NODE_ENV=production`. It is not a stand-in for KMS in any shared environment.
- Secrets Manager holds infrastructure secrets (database URL, Auth.js secret, SES configuration). It is not the user vault. User secrets in Secrets Manager would couple tenant lifecycle to IAM and make RLS harder; they stay in Postgres as ciphertext.

## Sessions, MFA, CAPTCHA

- `storageState` is replayed on later runs and refreshed after a successful re-login.
- Unexpected login, MFA, SSO, or CAPTCHA: status `needs-login`, failure email, Re-login opens a live session with that state.
- TOTP secrets are vault entries. The runner generates a code at the step. The seed never appears in the workflow JSON or the email.
- The runner does not attempt CAPTCHA. Treating CAPTCHA as `needs-login` is the control.
- A portal that binds the session to the worker IP will `needs-login` on every new task. That is expected hosted-platform behavior, not a bug to route around with a permanent residential proxy. Do not add an IP-rotation feature; it is out of scope and it is the wrong product.

## Audit and abuse limits

Audit at least: login, role change, credential write (not the value), workflow save, schedule change, run start, re-login, notification recipient change, org suspend.

Rate limits on sign-up, login, record-session create, and run-now. Domain denylist checked at record start and again at run start, because a workflow can be edited.

## Accepted risks

- Hosted Chromium is a large attack surface. Isolation is per task, not a formal sandbox product such as gVisor, unless Phase 5 adds it. gVisor or Firecracker would reduce T5 and should be revisited before public launch if the cost is acceptable.
- The live screencast of a recording is not masked in transit to the owner. They are typing the password themselves.
- A 24-hour signed screenshot URL is a bearer token for that image.
- A crash window during the SES API call can, rarely, send a duplicate. The outbox row stays unique.
- Operators with broad IAM can decrypt tenant data. Production access to `kms:Decrypt` should be break-glass, not daily engineer credentials.
- VPN-only and IP-allowlisted portals do not work on the hosted runners. Pretending otherwise would push users toward unsafe network exceptions.

## Out of scope

- Breaking CAPTCHA, bypassing bot detection, or staying ahead of a vendor's anti-automation.
- Recording mobile apps or desktop apps.
- Giving workers a path to customer networks. The later self-hosted runner connects outbound to our queue; we do not accept inbound tunnels in this design.

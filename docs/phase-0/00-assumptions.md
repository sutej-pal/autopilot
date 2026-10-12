# Assumptions

These are the defaults behind the rest of Phase 0. Each one is reversible before the phase that would make it expensive to change. They are not facts about the target portal.

## Product

- AutoPilot replays a browser workflow the user recorded on a site they are allowed to automate. The first workflow is a daily timesheet. The engine stays general-purpose: steps, locators, variables, and assertions, not timesheet-specific code.
- "Exactly" means the same step list, the same locator fallback order, and the same variable resolution. It does not mean pixel-identical timing. There are no recorded delays. Replay uses Playwright auto-waiting.
- A run is successful only when every success-check assertion passes. Any other terminal state is a failure and, for scheduled runs, produces one notification row.
- Hosted workers can reach the public internet only. Sites that require a VPN, a private network, or an IP allowlist are a documented product limitation until a self-hosted runner exists. The worker image is shaped so that runner can be the same code with an outbound-only queue connection.
- Users may automate only sites whose terms allow it. The product enforces quotas and a domain denylist; it cannot verify the user's legal right to automate a site.

## Target portal (answered 2026-10-12)

Recorded in [portal profile](./10-portal-timesheet.md).

- The timesheet site is on the public internet. No VPN and no office IP allowlist.
- Sign-in is email and password. No MFA or SSO was described. If a CAPTCHA or extra challenge appears anyway, the run stops as `needs-login`.
- The date is chosen from a datepicker, not typed. Phase 1 records those clicks and flags them `date-widget`. Those clicks will select the wrong day on later runs. `pick-date` waits until Phase 5.
- Submitting a second entry for the same date **adds** the hours. 8 hours plus another 8 hours on that date becomes 16. After an entry exists, the only safe action is to modify that entry. A retry must not create again.
- The workflow timezone defaults to `Asia/Kolkata` from the user profile. Schedules are wall-clock times in that zone, stored as UTC instants.
- The site URL is still unknown. Phase 1 rehearses on a public demo and a local fixture, not on the real portal.

## Hosting until a replay succeeds

Local Node on this machine, file-backed vault, no cloud resources. Scale-up, including any free-tier account, waits until record-and-replay has been run and the result is worth paying to host. See the decision at the top of [cost estimate](./07-cost-estimate.md).

## Stack choices inside the approved set

- **Drizzle** for Postgres access and SQL migrations. Row-level security and partial unique indexes need to stay visible as SQL. Prisma stays unused unless you reject Drizzle.
- **AWS CDK (TypeScript)** for infrastructure, written in Phase 5. Terraform remains acceptable if you already operate it; say so before Phase 5.
- **Auth.js** in `apps/web` for email+password and Google. Fastify does not trust the Next.js process as a user. It verifies the Auth.js session JWT. The database holds users, organizations, and memberships.
- One public hostname. The load balancer paths `/` to Next.js and `/api` plus `/ws` to Fastify so the session cookie is first-party.
- Region assumption for the cost sketch: `ap-south-1`, with prices estimated from us-east-1 list prices plus about 10%. SES production access is not assumed to exist on day one.

## Reliability defaults

- Scheduler tick: 15 seconds. Materialization horizon: 24 hours.
- Catch-up default: `run-if-within-120-minutes`.
- Business retries: 1, and only when the failure happened before the commit step or an idempotency guard shows the submit did not land.
- Overlap policy: one active run per workflow. A second trigger gets `409` (manual) or stays queued until the active run finishes (scheduled). It is never started in parallel.
- Max run duration default: 10 minutes. Hard tenant cap in the design: 30 minutes.
- Notification collapse window default: 60 minutes. Each failed run still gets its own outbox row. The dispatcher may send one SES message for several rows inside the window. See [email and reliability](./05-email-and-reliability.md).

## Explicit non-goals for v1

- Solving CAPTCHA, bypassing MFA, or staying logged in through a step-up the site will not allow.
- Recording inside cross-origin canvas apps, WebGL, or desktop applications.
- Pixel-perfect remote desktop (that would be noVNC; we are not choosing it).
- Multi-region active-active. One region, Multi-AZ data plane.
- A self-hosted runner binary shipped to customers. The interface is reserved; the agent is not built.

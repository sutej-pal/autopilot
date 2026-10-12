# Timesheet portal

Answered 2026-10-12. This replaces the guessed portal defaults. The site URL was not provided.

| Question | Answer |
| --- | --- |
| Network | Public internet |
| Login | Email and password |
| Date | Selected from a datepicker |
| Second submit, same date | Hours are added. 8, then 8 again, displays as 16 |
| After an entry exists | It can be modified only |

## What this changes

The create workflow is not idempotent. A retry that submits another 8 hours does not get rejected and does not open a second row the user can ignore. It changes the stored total.

Required shape for the daily create workflow:

1. Sign in with `{{credentials.username}}` and `{{credentials.password}}` if the saved session is missing.
2. Open the datepicker and choose `{{today}}`. Phase 1 only records the clicks and sets `flags: ["date-widget"]`. Replaying those clicks on a later day is expected to be wrong until the Phase 5 `pick-date` step.
3. Guard, immediately before submit: today's entry is not already on the page. `onFail: "already-done"`. The run ends `succeeded` / `already-satisfied` and does not submit.
4. Fill hours (default variable `hours` = `8`) and submit. That click is `commit: true`.
5. Assert the success text the portal actually shows.

If the entry already exists and the hours must change, that is a separate edit workflow: open the existing entry and set the absolute hours. It must not run the create submit.

No MFA was mentioned. The runner will still stop with `needs-login` if the portal later shows a challenge, a CAPTCHA, or an SSO redirect.

## Still unknown

- Portal URL and product name.
- The success text after a real submit.
- Whether "modified only" means the create button disappears, or the create button remains and a second use adds hours. The hours example says a second add accumulates, so the guard treats any existing entry for that date as "do not create."
- Whether a saved session survives a new runner IP. If it does not, every hosted run will stop at `needs-login` until re-login.

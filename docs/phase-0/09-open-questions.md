# Open questions

Answered 2026-10-12. Details: [portal profile](./10-portal-timesheet.md).

| Question | Answer |
| --- | --- |
| Public internet, VPN, or IP allowlist? | Public internet |
| Login | Email and password |
| Date control | Datepicker (click), not a field you type |
| Two submits on one date | Hours add. 8 + 8 = 16. After that, modify the entry only |

Phase 1 can rehearse on a public demo. It cannot record the real timesheet until the URL is known, and it cannot pick "today" from that datepicker reliably until Phase 5.

## Still needed before a real-portal run

1. The portal URL (and a test account you are allowed to automate).
2. When today's entry already exists, should the scheduled run stop, or open the entry and set the hours to an absolute value such as 8?
3. The exact success message the portal shows after a submit, so the success check can match it.

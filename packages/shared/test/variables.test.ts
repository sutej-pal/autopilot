import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, renderTemplate, templatizeValue, weekdayName } from "../src/variables.js";

const now = new Date("2026-10-12T12:30:00.000Z");
const timezone = "Asia/Kolkata";

test("today formats in the workflow timezone", () => {
  assert.equal(formatDate(now, timezone, "YYYY-MM-DD"), "2026-10-12");
  assert.equal(formatDate(now, timezone, "DD/MM/YYYY"), "12/10/2026");
  assert.equal(formatDate(now, timezone, "D MMM YYYY"), "12 Oct 2026");
  assert.equal(weekdayName(now, timezone), "Monday");
});

test("templates resolve credentials, variables, and dates", () => {
  const ctx = {
    now,
    timezone,
    credentials: { username: "user@example.com", password: "secret" },
    variables: { hours: "8" },
  };
  assert.equal(renderTemplate("{{today}}", ctx), "2026-10-12");
  assert.equal(renderTemplate("{{today|DD/MM/YYYY}}", ctx), "12/10/2026");
  assert.equal(renderTemplate("{{hours}}", ctx), "8");
  assert.equal(renderTemplate("{{credentials.password}}", ctx), "secret");
});

test("unknown formats and variables fail closed", () => {
  assert.throws(() => formatDate(now, timezone, "YYYY/MM/DD fancy"));
  assert.throws(() =>
    renderTemplate("{{missing}}", {
      now,
      timezone,
      credentials: {},
      variables: {},
    }),
  );
});

test("a value equal to today becomes a date template", () => {
  assert.equal(templatizeValue("2026-10-12", now, timezone), "{{today|YYYY-MM-DD}}");
  assert.equal(templatizeValue("8", now, timezone), "8");
});

const ALLOWED_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "D MMM YYYY"] as const;
export type DateFormat = (typeof ALLOWED_FORMATS)[number];

export type RenderContext = {
  now: Date;
  timezone: string;
  credentials: Record<string, string>;
  variables: Record<string, string>;
};

type DateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function parts(now: Date, timeZone: string): DateParts {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => formatted.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function formatDate(now: Date, timeZone: string, format: string): string {
  if (!ALLOWED_FORMATS.includes(format as DateFormat)) {
    throw new Error(`Unsupported date format: ${format}`);
  }
  const value = parts(now, timeZone);
  if (format === "YYYY-MM-DD") return `${value.year}-${value.month}-${value.day}`;
  if (format === "DD/MM/YYYY") return `${value.day}/${value.month}/${value.year}`;
  if (format === "MM/DD/YYYY") return `${value.month}/${value.day}/${value.year}`;
  const monthShort = new Intl.DateTimeFormat("en-GB", { timeZone, month: "short" }).format(now);
  return `${Number(value.day)} ${monthShort} ${value.year}`;
}

export function weekdayName(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
}

export function zonedTimestamp(now: Date, timeZone: string): string {
  const value = parts(now, timeZone);
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}`;
}

const TEMPLATE = /\{\{\s*([A-Za-z0-9_.]+)\s*(?:\|\s*([^}]+?)\s*)?\}\}/g;

export function renderTemplate(input: string, ctx: RenderContext): string {
  return input.replace(TEMPLATE, (_match, name: string, format?: string) => {
    if (name === "today") return formatDate(ctx.now, ctx.timezone, format || "YYYY-MM-DD");
    if (format) throw new Error(`Format is only valid on {{today}}: {{${name}|${format}}}`);
    if (name === "now") return zonedTimestamp(ctx.now, ctx.timezone);
    if (name === "weekday") return weekdayName(ctx.now, ctx.timezone);
    if (name.startsWith("credentials.")) {
      const key = name.slice("credentials.".length);
      const value = ctx.credentials[key];
      if (value === undefined) throw new Error(`Missing credential: ${key}`);
      return value;
    }
    const variable = ctx.variables[name];
    if (variable === undefined) throw new Error(`Unknown variable: ${name}`);
    return variable;
  });
}

export function templatizeValue(value: string, now: Date, timezone: string): string {
  for (const format of ALLOWED_FORMATS) {
    if (value === formatDate(now, timezone, format)) return `{{today|${format}}}`;
  }
  return value;
}

export function credentialNameForField(hint: {
  type?: string;
  name?: string;
  id?: string;
  label?: string;
  autocomplete?: string;
}): "username" | "password" | null {
  const type = (hint.type || "").toLowerCase();
  if (type === "password" || (hint.autocomplete || "").includes("password")) return "password";
  const blob = `${hint.name || ""} ${hint.id || ""} ${hint.label || ""} ${hint.autocomplete || ""}`.toLowerCase();
  if (type === "email" || blob.includes("email") || blob.includes("user")) return "username";
  return null;
}

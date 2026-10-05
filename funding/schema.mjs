import { createHash } from "node:crypto";

const string = { type: "string" };
const strings = { type: "array", items: string };
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export const reportSchema = object({
  summary: string,
  searched: strings,
  warnings: strings,
  opportunities: { type: "array", items: object({
    title: string, organization: string,
    kind: { type: "string", enum: ["cash", "in_kind", "prize", "sponsorship", "information"] },
    benefit: string,
    deadline: { type: ["string", "null"] },
    eligibility: { type: "string", enum: ["likely", "uncertain", "ineligible"] },
    eligibilityReason: string, fitReason: string,
    requirements: strings, nextSteps: strings,
    sources: { type: "array", items: object({ url: string, title: string, evidence: string }) },
    actions: { type: "array", items: object({
      kind: { type: "string", enum: ["prepare_brief", "send_email"] },
      title: string, recipient: string, subject: string, body: string,
    }) },
  }) },
});

export const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function check(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

function validate(value, schema, field = "report") {
  if (Array.isArray(schema.type)) {
    if (value === null && schema.type.includes("null")) return;
    return validate(value, { ...schema, type: "string" }, field);
  }
  if (schema.type === "object") {
    check(value && typeof value === "object" && !Array.isArray(value), `${field}: object required`);
    check(Object.keys(value).every((key) => Object.hasOwn(schema.properties, key)), `${field}: unknown field`);
    for (const [key, child] of Object.entries(schema.properties)) validate(value[key], child, `${field}.${key}`);
  } else if (schema.type === "array") {
    check(Array.isArray(value) && value.length <= 30, `${field}: array of at most 30 items required`);
    value.forEach((item, index) => validate(item, schema.items, `${field}[${index}]`));
  } else {
    check(typeof value === "string" && value.length <= 12000, `${field}: string required (max 12000)`);
    if (schema.enum) check(schema.enum.includes(value), `${field}: invalid choice`);
  }
}

export function sourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { check(false, "Invalid source URL"); }
  check(url.protocol === "https:" && !url.username && !url.password, "HTTPS source required");
  check(!/^(localhost|.*\.local|.*\.internal|\[.*\]|[\d.]+)$/i.test(url.hostname), "Public source required");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}

export function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
}

export function validateAction(payload) {
  check(["prepare_brief", "send_email"].includes(payload.kind), "Unsupported action");
  for (const field of ["title", "body"]) check(typeof payload[field] === "string" && payload[field].trim().length > 0 && payload[field].length <= 12000, `Invalid ${field}`);
  check(typeof payload.subject === "string" && payload.subject.length <= 300 && !/[\r\n]/.test(payload.subject), "Invalid subject");
  if (payload.kind === "send_email") {
    check(validEmail(payload.recipient), "A single valid recipient is required");
    check(payload.subject.trim(), "Email subject required");
  } else check(payload.recipient === "", "A document must not have a recipient");
}

export function validateReport(input, date) {
  validate(input, reportSchema);
  check(input.summary.trim() && input.searched.length, "Search summary and searched queries are required");
  const seen = new Set();
  const opportunities = input.opportunities.map((item) => {
    check(item.title.trim() && item.organization.trim() && item.sources.length > 0, "Title, organization and sources required");
    if (item.deadline !== null) {
      check(/^\d{4}-\d{2}-\d{2}$/.test(item.deadline) && Number.isFinite(Date.parse(item.deadline)) && new Date(item.deadline).toISOString().slice(0, 10) === item.deadline, "Invalid deadline");
      check(item.deadline >= date, "Expired opportunities must not be recommended");
    }
    const sources = item.sources.map((s) => {
      check(s.title.trim() && s.evidence.trim(), "Source evidence required");
      return { ...s, url: sourceUrl(s.url) };
    });
    const key = digest([sources[0].url, item.deadline]);
    check(!seen.has(key), "Duplicate opportunity");
    seen.add(key);
    check(item.actions.length <= 2 && new Set(item.actions.map((a) => a.kind)).size === item.actions.length, "At most one action of each type is allowed");
    item.actions.forEach(validateAction);
    check(item.eligibility !== "ineligible" || item.actions.length === 0, "Ineligible opportunities cannot have actions");
    return { ...item, key, sources };
  });
  return { ...input, opportunities };
}

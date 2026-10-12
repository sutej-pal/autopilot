export const CAPTURE_SCRIPT = `(() => {
  if (window.__autopilotInstalled) return;
  window.__autopilotInstalled = true;
  let seq = 0;
  const pending = new Map();

  const report = (payload) => {
    const send = window.__autopilotRecord;
    if (typeof send !== "function") return;
    void send(payload);
  };

  const eid = (el) => {
    if (!el.dataset.autopilotEid) el.dataset.autopilotEid = String(++seq);
    return el.dataset.autopilotEid;
  };

  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      return "textbox";
    }
    return null;
  };

  const nameOf = (el) => {
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const text = labelledby
        .split(/\\s+/)
        .map((id) => document.getElementById(id)?.innerText || "")
        .join(" ")
        .trim();
      if (text) return text;
    }
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label && label.innerText && label.innerText.trim()) return label.innerText.trim();
    }
    const parent = el.closest("label");
    if (parent) {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll("input,textarea,select,button").forEach((node) => node.remove());
      const text = (clone.textContent || "").trim();
      if (text) return text;
    }
    if (el.tagName === "BUTTON" || el.tagName === "A") {
      const text = (el.innerText || "").trim();
      if (text && text.length <= 80) return text;
    }
    return null;
  };

  const locatorsFor = (el) => {
    const list = [];
    const role = roleOf(el);
    const name = nameOf(el);
    if (role && name) list.push({ strategy: "role", role, name });
    if (name && (el.closest("label") || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')))) {
      list.push({ strategy: "label", text: name });
    }
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) list.push({ strategy: "placeholder", text: placeholder });
    const visible = (el.innerText || "").trim();
    if (visible && visible.length <= 80 && el.children.length === 0) list.push({ strategy: "text", text: visible });
    const testid = el.getAttribute("data-testid");
    if (testid) list.push({ strategy: "testid", value: testid });
    if (el.id) list.push({ strategy: "id", value: el.id });
    const attrName = el.getAttribute("name");
    if (attrName) list.push({ strategy: "name", value: attrName });
    if (el.id) list.push({ strategy: "css", value: "#" + CSS.escape(el.id) });
    else if (testid) list.push({ strategy: "css", value: '[data-testid="' + CSS.escape(testid) + '"]' });
    else if (attrName) list.push({ strategy: "css", value: el.tagName.toLowerCase() + '[name="' + CSS.escape(attrName) + '"]' });
    if (el.id) list.push({ strategy: "xpath", value: '//*[@id="' + el.id.replace(/"/g, "") + '"]' });
    const seen = new Set();
    return list.filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const inView = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
  };

  const dateWidget = (el) =>
    Boolean(el.closest('[data-date-widget], .datepicker, .flatpickr-calendar, .react-datepicker, .ui-datepicker, [class*="datepicker" i]'));

  const describe = (el, kind) => {
    const name = nameOf(el) || el.getAttribute("placeholder") || el.id || el.tagName.toLowerCase();
    const short = String(name).slice(0, 80);
    if (kind === "click") return 'Click "' + short + '"';
    if (kind === "dblclick") return 'Double-click "' + short + '"';
    if (kind === "fill") return 'Fill "' + short + '"';
    if (kind === "select") return 'Select "' + short + '"';
    return short;
  };

  const commitFill = (el) => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "checkbox" || type === "radio" || type === "submit" || type === "button" || type === "file") return;
    const tag = el.tagName.toLowerCase();
    const kind = tag === "select" ? "select" : "fill";
    report({
      kind,
      eid: eid(el),
      locators: locatorsFor(el),
      description: describe(el, kind),
      value: el.value ?? "",
      fieldType: type,
      fieldName: el.getAttribute("name") || "",
      fieldId: el.id || "",
      label: nameOf(el) || "",
      autocomplete: el.getAttribute("autocomplete") || "",
      text: (el.innerText || "").trim(),
    });
  };

  document.addEventListener("input", (event) => {
    const el = event.target;
    if (!el || el.nodeType !== 1) return;
    const id = eid(el);
    clearTimeout(pending.get(id));
    pending.set(id, setTimeout(() => commitFill(el), 400));
  }, true);

  document.addEventListener("change", (event) => {
    const el = event.target;
    if (!el || el.nodeType !== 1) return;
    const id = eid(el);
    clearTimeout(pending.get(id));
    pending.delete(id);
    commitFill(el);
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!target || target.nodeType !== 1 || target === document.body || target === document.documentElement) return;
    const el = target.closest("button, a, input, select, textarea, label, [role='button']") || target;
    if (event.detail === 2) return;
    const flags = [];
    if (dateWidget(el)) flags.push("date-widget");
    if (!inView(el)) flags.push("scroll");
    report({
      kind: "click",
      eid: eid(el),
      locators: locatorsFor(el),
      description: describe(el, "click"),
      flags,
      fieldType: (el.getAttribute && el.getAttribute("type")) || "",
      text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 120),
    });
  }, true);

  document.addEventListener("dblclick", (event) => {
    const target = event.target;
    if (!target || target.nodeType !== 1) return;
    const el = target.closest("button, a, input, [role='button']") || target;
    report({
      kind: "dblclick",
      eid: eid(el),
      locators: locatorsFor(el),
      description: describe(el, "dblclick"),
      text: (el.innerText || "").trim().slice(0, 120),
    });
  }, true);
})();`;

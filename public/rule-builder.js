/** Billingmgmt — attribute-conditioned rule builder (chargeType: conditionalPer) */

const RULE_BUILDER_OPS = [
  { id: "eq", label: "=" },
  { id: "ne", label: "≠" },
  { id: "in", label: "in" },
  { id: "notIn", label: "not in" },
  { id: "gt", label: ">" },
  { id: "gte", label: "≥" },
  { id: "lt", label: "<" },
  { id: "lte", label: "≤" },
  { id: "contains", label: "contains" },
  { id: "isEmpty", label: "is empty" },
  { id: "isNotEmpty", label: "is not empty" },
];

const VALUELESS_OPS = new Set(["isEmpty", "isNotEmpty"]);

let _inventoryCache = null;
let _inventoryPromise = null;

function escapeRb(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadInventory() {
  if (_inventoryCache) return _inventoryCache;
  if (_inventoryPromise) return _inventoryPromise;
  _inventoryPromise = fetch("/data/rule_inventory/rule_inventory.json")
    .then(async (res) => {
      if (!res.ok) throw new Error(`Inventory HTTP ${res.status}`);
      const data = await res.json();
      _inventoryCache = data;
      return data;
    })
    .catch((err) => {
      _inventoryPromise = null;
      console.warn("[rule-builder] inventory load failed", err);
      return {
        billingIndex: { byActivityHint: {}, attributes: [] },
        components: [],
        note: String(err.message || err),
      };
    });
  return _inventoryPromise;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function componentsFromInventory(inventory) {
  const set = new Set();
  for (const a of inventory?.billingIndex?.attributes || []) {
    if (a.component) set.add(a.component);
  }
  for (const c of inventory?.components || []) {
    if (c.component) set.add(c.component);
  }
  return [...set].sort();
}

function filterAttributes(inventory, { component, query }) {
  let attrs = inventory?.billingIndex?.attributes || [];
  if (component) attrs = attrs.filter((a) => a.component === component);
  const q = (query || "").trim().toLowerCase();
  if (q) {
    attrs = attrs.filter((a) => {
      const hay = `${a.key} ${a.label || ""} ${a.attribute || ""} ${a.entity || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }
  return attrs.slice(0, 400);
}

function opNeedsValue(op) {
  return !VALUELESS_OPS.has(op);
}

function summarizeCondition(c) {
  const left = [c.entity, c.attribute].filter(Boolean).join(".") || c.attribute || "?";
  const op = RULE_BUILDER_OPS.find((o) => o.id === c.operator)?.label || c.operator;
  if (!opNeedsValue(c.operator)) return `${left} ${op}`;
  return `${left} ${op} ${c.value ?? ""}`;
}

function summarizeBranch(branch) {
  const conds = branch?.match?.conditions || [];
  const logic = (branch?.match?.logic || "and").toUpperCase();
  const matchText = conds.length
    ? conds.map(summarizeCondition).join(` ${logic} `)
    : "(no conditions)";
  const charge = branch?.charge || {};
  const rate =
    charge.type === "fixed"
      ? `$${Number(charge.rate || 0).toFixed(2)} fixed`
      : `$${Number(charge.rate || 0).toFixed(2)} / unit`;
  return `If ${matchText} → ${rate}`;
}

function defaultBranch() {
  return {
    id: uid("br"),
    label: "",
    match: {
      logic: "and",
      conditions: [
        {
          entity: "",
          attribute: "",
          operator: "eq",
          value: "",
        },
      ],
    },
    charge: { type: "per", rate: 0 },
  };
}

function ensureConditionalShape(record) {
  const next = { ...(record || {}) };
  if (!Array.isArray(next.branches) || !next.branches.length) {
    next.branches = [defaultBranch()];
  }
  if (!next.defaultCharge) {
    next.defaultCharge = { type: "per", rate: 0 };
  }
  if (!next.attributeSource) {
    next.attributeSource = { component: "receiving", ruleTypeId: null };
  }
  return next;
}

function renderConditionRow(cond, attrOptionsHtml) {
  const needsVal = opNeedsValue(cond.operator || "eq");
  const opOpts = RULE_BUILDER_OPS.map(
    (o) =>
      `<option value="${o.id}"${(cond.operator || "eq") === o.id ? " selected" : ""}>${escapeRb(o.label)}</option>`
  ).join("");
  return `<div class="rb-condition" data-role="condition">
    <input class="form-control form-control-sm" data-field="entity" placeholder="entity" value="${escapeRb(cond.entity || "")}" list="rb-entity-hints" />
    <select class="form-select form-select-sm" data-field="attributeKey">${attrOptionsHtml}</select>
    <select class="form-select form-select-sm" data-field="operator">${opOpts}</select>
    <input class="form-control form-control-sm" data-field="value" placeholder="value" value="${escapeRb(cond.value ?? "")}" ${needsVal ? "" : "disabled"} />
    <button type="button" class="btn btn-link btn-sm text-danger" data-action="remove-condition" title="Remove condition">&times;</button>
  </div>`;
}

function attrOptionsFor(inventory, component, selectedAttr, selectedEntity) {
  const attrs = filterAttributes(inventory, { component, query: "" });
  const opts = [`<option value="">— select attribute —</option>`];
  let matched = false;
  for (const a of attrs) {
    const sel =
      a.attribute === selectedAttr &&
      (selectedEntity == null || selectedEntity === "" || a.entity === selectedEntity || !a.entity);
    if (sel) matched = true;
    const label = a.entity
      ? `${a.entity}.${a.attribute}`
      : a.attribute;
    opts.push(
      `<option value="${escapeRb(a.key)}" data-entity="${escapeRb(a.entity || "")}" data-attribute="${escapeRb(a.attribute || "")}"${sel ? " selected" : ""}>${escapeRb(label)}</option>`
    );
  }
  if (selectedAttr && !matched) {
    const key = `custom.${selectedEntity || "unknown"}.${selectedAttr}`;
    opts.push(
      `<option value="${escapeRb(key)}" data-entity="${escapeRb(selectedEntity || "")}" data-attribute="${escapeRb(selectedAttr)}" selected>${escapeRb([selectedEntity, selectedAttr].filter(Boolean).join(".") || selectedAttr)} (custom)</option>`
    );
  }
  return opts.join("");
}

function renderBuilderHtml(record, inventory) {
  const shaped = ensureConditionalShape(record);
  const component = shaped.attributeSource?.component || "receiving";
  const components = componentsFromInventory(inventory);
  const compOpts = components
    .map((c) => `<option value="${escapeRb(c)}"${c === component ? " selected" : ""}>${escapeRb(c)}</option>`)
    .join("");

  const branchHtml = shaped.branches
    .map((branch, idx) => {
      const condHtml = (branch.match?.conditions || [])
        .map((c) => renderConditionRow(c, attrOptionsFor(inventory, component, c.attribute, c.entity)))
        .join("");
      const chargeType = branch.charge?.type || "per";
      return `<div class="rb-branch card-panel" data-role="branch" data-branch-id="${escapeRb(branch.id)}">
        <div class="rb-branch-head">
          <strong>Branch ${idx + 1}</strong>
          <input class="form-control form-control-sm rb-branch-label" data-field="label" placeholder="Label (optional)" value="${escapeRb(branch.label || "")}" />
          <select class="form-select form-select-sm" data-field="logic" title="Condition logic">
            <option value="and"${(branch.match?.logic || "and") === "and" ? " selected" : ""}>AND</option>
            <option value="or"${branch.match?.logic === "or" ? " selected" : ""}>OR</option>
          </select>
          <button type="button" class="btn btn-outline-danger btn-sm" data-action="remove-branch">Remove</button>
        </div>
        <div class="rb-conditions" data-role="conditions">${condHtml}</div>
        <button type="button" class="btn btn-link btn-sm px-0" data-action="add-condition">+ condition</button>
        <div class="rb-charge row g-2 align-items-end mt-1">
          <div class="col-auto">
            <label class="form-label mb-0 small">Charge</label>
            <select class="form-select form-select-sm" data-field="chargeType">
              <option value="per"${chargeType === "per" ? " selected" : ""}>Per unit</option>
              <option value="fixed"${chargeType === "fixed" ? " selected" : ""}>Fixed</option>
            </select>
          </div>
          <div class="col-auto">
            <label class="form-label mb-0 small">Rate</label>
            <input class="form-control form-control-sm" type="number" step="0.01" data-field="rate" value="${escapeRb(branch.charge?.rate ?? 0)}" />
          </div>
        </div>
        <p class="rb-preview small text-muted mb-0 mt-2">${escapeRb(summarizeBranch(branch))}</p>
      </div>`;
    })
    .join("");

  const defType = shaped.defaultCharge?.type || "per";
  const crawled = inventory?.crawledAt
    ? `Inventory: ${inventory.crawledAt}`
    : inventory?.source || "inventory";

  return `<div class="rule-builder" data-role="rule-builder">
    <div class="rb-header">
      <h6 class="mb-1">Conditional charges</h6>
      <p class="small text-muted mb-2">If attribute matches → rate. First matching branch wins; optional default/else below. <span class="rb-inv-meta">${escapeRb(crawled)}</span></p>
      <div class="row g-2 align-items-end mb-2">
        <div class="col-md-4">
          <label class="form-label mb-0 small">Attribute source (component)</label>
          <select class="form-select form-select-sm" data-field="component">${compOpts || '<option value="receiving">receiving</option>'}</select>
        </div>
        <div class="col-md-5">
          <label class="form-label mb-0 small">Filter attributes</label>
          <input class="form-control form-control-sm" data-field="attrFilter" placeholder="Search attributes…" />
        </div>
        <div class="col-md-3">
          <button type="button" class="btn btn-outline-primary btn-sm w-100" data-action="add-branch">+ branch</button>
        </div>
      </div>
    </div>
    <datalist id="rb-entity-hints">
      <option value="asn"></option>
      <option value="lpnDetail"></option>
      <option value="ilpn"></option>
      <option value="order"></option>
      <option value="orderLine"></option>
      <option value="olpn"></option>
      <option value="item"></option>
      <option value="shipment"></option>
    </datalist>
    <div class="rb-branches" data-role="branches">${branchHtml}</div>
    <div class="rb-default card-panel mt-2">
      <strong>Default / else</strong>
      <div class="rb-charge row g-2 align-items-end mt-1">
        <div class="col-auto">
          <select class="form-select form-select-sm" data-field="defaultChargeType">
            <option value="per"${defType === "per" ? " selected" : ""}>Per unit</option>
            <option value="fixed"${defType === "fixed" ? " selected" : ""}>Fixed</option>
          </select>
        </div>
        <div class="col-auto">
          <input class="form-control form-control-sm" type="number" step="0.01" data-field="defaultRate" value="${escapeRb(shaped.defaultCharge?.rate ?? 0)}" />
        </div>
      </div>
    </div>
  </div>`;
}

function readConditionEl(el) {
  const op = el.querySelector('[data-field="operator"]')?.value || "eq";
  const attrSel = el.querySelector('[data-field="attributeKey"]');
  const opt = attrSel?.selectedOptions?.[0];
  let entity = el.querySelector('[data-field="entity"]')?.value?.trim() || "";
  let attribute = "";
  if (opt && opt.value) {
    attribute = opt.dataset.attribute || "";
    if (!entity && opt.dataset.entity) entity = opt.dataset.entity;
  }
  if (!attribute && attrSel?.value) {
    const parts = attrSel.value.split(".");
    attribute = parts[parts.length - 1] || "";
  }
  const value = opNeedsValue(op) ? el.querySelector('[data-field="value"]')?.value ?? "" : null;
  return { entity, attribute, operator: op, value };
}

function collectFromHost(host) {
  if (!host) return null;
  const root = host.querySelector('[data-role="rule-builder"]');
  if (!root) return null;
  const component = root.querySelector('[data-field="component"]')?.value || "receiving";
  const branches = [];
  root.querySelectorAll('[data-role="branch"]').forEach((branchEl) => {
    const conditions = [];
    branchEl.querySelectorAll('[data-role="condition"]').forEach((cEl) => {
      const c = readConditionEl(cEl);
      if (c.attribute || c.entity) conditions.push(c);
    });
    const rateRaw = branchEl.querySelector('[data-field="rate"]')?.value;
    branches.push({
      id: branchEl.dataset.branchId || uid("br"),
      label: branchEl.querySelector('[data-field="label"]')?.value?.trim() || "",
      match: {
        logic: branchEl.querySelector('[data-field="logic"]')?.value || "and",
        conditions,
      },
      charge: {
        type: branchEl.querySelector('[data-field="chargeType"]')?.value || "per",
        rate: rateRaw === "" || rateRaw == null ? 0 : Number(rateRaw),
      },
    });
  });
  const defRate = root.querySelector('[data-field="defaultRate"]')?.value;
  return {
    attributeSource: { component, ruleTypeId: null },
    branches,
    defaultCharge: {
      type: root.querySelector('[data-field="defaultChargeType"]')?.value || "per",
      rate: defRate === "" || defRate == null ? 0 : Number(defRate),
    },
  };
}

function bindBuilder(host, inventory, recordRef) {
  const root = host.querySelector('[data-role="rule-builder"]');
  if (!root) return;

  const rerender = () => {
    const collected = collectFromHost(host) || ensureConditionalShape(recordRef);
    Object.assign(recordRef, collected, { chargeType: "conditionalPer" });
    host.innerHTML = renderBuilderHtml(recordRef, inventory);
    bindBuilder(host, inventory, recordRef);
  };

  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches('[data-field="operator"]')) {
      const row = t.closest('[data-role="condition"]');
      const val = row?.querySelector('[data-field="value"]');
      if (val) val.disabled = !opNeedsValue(t.value);
    }
    if (t.matches('[data-field="attributeKey"]')) {
      const row = t.closest('[data-role="condition"]');
      const opt = t.selectedOptions?.[0];
      const entityInput = row?.querySelector('[data-field="entity"]');
      if (entityInput && opt?.dataset.entity && !entityInput.value) {
        entityInput.value = opt.dataset.entity;
      }
    }
    if (t.matches('[data-field="component"]')) {
      rerender();
    }
  });

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const current = collectFromHost(host) || ensureConditionalShape(recordRef);

    if (action === "add-branch") {
      current.branches.push(defaultBranch());
    } else if (action === "remove-branch") {
      const branchEl = btn.closest('[data-role="branch"]');
      const id = branchEl?.dataset.branchId;
      current.branches = current.branches.filter((b) => b.id !== id);
      if (!current.branches.length) current.branches = [defaultBranch()];
    } else if (action === "add-condition") {
      const branchEl = btn.closest('[data-role="branch"]');
      const id = branchEl?.dataset.branchId;
      const branch = current.branches.find((b) => b.id === id);
      if (branch) {
        branch.match.conditions.push({
          entity: "",
          attribute: "",
          operator: "eq",
          value: "",
        });
      }
    } else if (action === "remove-condition") {
      const branchEl = btn.closest('[data-role="branch"]');
      const condEl = btn.closest('[data-role="condition"]');
      const id = branchEl?.dataset.branchId;
      const branch = current.branches.find((b) => b.id === id);
      if (branch && condEl) {
        const idx = [...branchEl.querySelectorAll('[data-role="condition"]')].indexOf(condEl);
        if (idx >= 0) branch.match.conditions.splice(idx, 1);
        if (!branch.match.conditions.length) {
          branch.match.conditions.push({
            entity: "",
            attribute: "",
            operator: "eq",
            value: "",
          });
        }
      }
    } else {
      return;
    }

    Object.assign(recordRef, current, { chargeType: "conditionalPer" });
    host.innerHTML = renderBuilderHtml(recordRef, inventory);
    bindBuilder(host, inventory, recordRef);
  });
}

function setSimpleFieldsVisible(modalBody, visible) {
  for (const key of ["conditions", "tiers"]) {
    const el = modalBody.querySelector(`[data-key="${key}"]`);
    const wrap = el?.closest(".mb-2");
    if (wrap) wrap.style.display = visible ? "" : "none";
  }
}

/**
 * Mount conditional rule builder into an edit modal body for transaction/storage rules.
 */
async function enhanceEditModal(modalBody, entityKey, record) {
  if (entityKey !== "rulesTransaction" && entityKey !== "rulesStorage") return;

  let host = modalBody.querySelector("#ruleBuilderHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "ruleBuilderHost";
    host.className = "rule-builder-host mt-3";
    modalBody.appendChild(host);
  }

  const inventory = await loadInventory();
  const working = {
    ...(record || {}),
    chargeType: record?.chargeType || "per",
  };

  const chargeSelect = modalBody.querySelector('[data-key="chargeType"]');
  const sync = () => {
    const ct = chargeSelect?.value || working.chargeType;
    working.chargeType = ct;
    if (ct === "conditionalPer") {
      setSimpleFieldsVisible(modalBody, false);
      host.style.display = "";
      const shaped = ensureConditionalShape(working);
      Object.assign(working, shaped);
      host.innerHTML = renderBuilderHtml(working, inventory);
      bindBuilder(host, inventory, working);
    } else {
      setSimpleFieldsVisible(modalBody, true);
      host.style.display = "none";
      host.innerHTML = "";
    }
  };

  if (chargeSelect && !chargeSelect.dataset.rbBound) {
    chargeSelect.dataset.rbBound = "1";
    chargeSelect.addEventListener("change", sync);
  }
  sync();
  host._rbWorking = working;
}

function applyToRecord(modalBody, record) {
  if (!record || record.chargeType !== "conditionalPer") {
    if (record) {
      delete record.branches;
      delete record.defaultCharge;
      delete record.attributeSource;
    }
    return record;
  }
  const host = modalBody.querySelector("#ruleBuilderHost");
  const collected = collectFromHost(host);
  if (!collected) return record;
  if (!collected.branches.length) {
    throw new Error("Add at least one conditional branch");
  }
  for (const [i, br] of collected.branches.entries()) {
    const ok = (br.match?.conditions || []).some((c) => c.attribute);
    if (!ok) throw new Error(`Branch ${i + 1} needs at least one attribute condition`);
  }
  record.attributeSource = collected.attributeSource;
  record.branches = collected.branches;
  record.defaultCharge = collected.defaultCharge;
  record.conditions = [];
  if ("tiers" in record) delete record.tiers;
  return record;
}

function normalizeRuleRecord(record) {
  if (!record || typeof record !== "object") return record;
  if (record.chargeType !== "conditionalPer") return record;
  if (!Array.isArray(record.branches)) record.branches = [];
  if (!record.defaultCharge) record.defaultCharge = { type: "per", rate: 0 };
  if (!record.attributeSource) record.attributeSource = { component: "receiving", ruleTypeId: null };
  return record;
}

window.BillingRuleBuilder = {
  loadInventory,
  enhanceEditModal,
  applyToRecord,
  normalizeRuleRecord,
  summarizeBranch,
};

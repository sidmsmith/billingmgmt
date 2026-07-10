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

/**
 * Field → MAWM objects where the field commonly appears.
 * Built from mawm_api_library search catalogs (ASN, PO, iLPN, oLPN, Order, Item, Location, Shipment, Appointment).
 * Keys are lowercased attribute names.
 */
const FIELD_OBJECTS = {
  // Identity / links
  asnid: ["ASN", "PO", "iLPN", "Appointment"],
  alternateasnid: ["ASN", "Appointment"],
  purchaseorderid: ["PO", "ASN", "iLPN", "Appointment"],
  alternatepurchaseorderid: ["PO", "Appointment"],
  purchaseorderlineid: ["PO", "ASN"],
  ilpnid: ["iLPN"],
  lpnid: ["iLPN", "ASN"],
  parentlpnid: ["iLPN", "ASN"],
  sourcelpnid: ["iLPN"],
  olpnid: ["oLPN"],
  orderid: ["Order", "oLPN"],
  orderlineid: ["Order", "oLPN"],
  shipmentid: ["Shipment", "Order", "oLPN", "iLPN", "Appointment"],
  itemid: ["Item", "ASN", "PO", "iLPN", "Order", "oLPN"],
  vendorid: ["ASN", "PO", "iLPN", "Appointment"],
  carrierid: ["ASN", "Shipment", "oLPN", "Appointment"],
  trailerid: ["ASN", "Appointment"],
  appointmentid: ["Appointment"],
  billofladingnumber: ["ASN", "Shipment", "Appointment"],
  pronumber: ["ASN", "Appointment"],
  facilityid: ["ASN", "PO", "iLPN", "Order", "oLPN", "Location", "Appointment"],
  orgid: ["ASN", "PO", "iLPN", "Order", "oLPN", "Shipment", "Appointment"],
  businessunitid: ["ASN", "PO", "iLPN", "Order"],
  destinationfacilityid: ["ASN", "PO", "Order", "Appointment"],
  originfacilityid: ["ASN", "PO", "Order", "oLPN"],
  // Status
  asnstaus: ["ASN"],
  asnstatus: ["ASN"],
  asnstatusdescription: ["ASN"],
  asnlevelid: ["ASN"],
  asnorigintypeid: ["ASN"],
  purchaseorderstatus: ["PO"],
  status: ["iLPN", "oLPN", "Order"],
  minimumstatus: ["Order"],
  maximumstatus: ["Order"],
  pipelinestatus: ["Order", "Shipment"],
  planningstatusid: ["Shipment"],
  transitstatusid: ["Shipment"],
  tenderstatusid: ["Shipment"],
  broadcaststatusid: ["Shipment"],
  invoicingstatusid: ["Shipment"],
  warehousestatusid: ["Shipment", "Order"],
  appointmentstatusid: ["Appointment"],
  // Attributes
  inventoryattribute1: ["ASN", "PO", "iLPN"],
  inventoryattribute2: ["ASN", "PO", "iLPN"],
  inventoryattribute3: ["ASN", "PO", "iLPN"],
  inventoryattribute4: ["ASN", "PO", "iLPN"],
  inventoryattribute5: ["ASN", "PO", "iLPN"],
  itemattribute1: ["Order", "oLPN"],
  itemattribute2: ["Order", "oLPN"],
  itemattribute3: ["Order", "oLPN"],
  itemattribute4: ["Order", "oLPN"],
  itemattribute5: ["Order", "oLPN"],
  batchnumber: ["ASN", "PO", "iLPN", "Order", "oLPN"],
  productstatusid: ["ASN", "PO", "iLPN", "Order", "oLPN"],
  countryoforigin: ["ASN", "PO", "iLPN"],
  // Location / container
  currentlocationid: ["iLPN", "oLPN"],
  picklocationid: ["oLPN"],
  locationid: ["Location"],
  locationtypeid: ["Location"],
  // Order / ship
  ordertype: ["Order", "oLPN"],
  billingmethodid: ["Order", "Shipment"],
  billtoname: ["Order", "oLPN"],
  shipviaid: ["Order", "oLPN", "Shipment"],
  servicelevelid: ["oLPN", "Shipment"],
  assignedcarrierid: ["Shipment", "Order"],
  // Appointment
  appointmenttypeid: ["Appointment"],
  contenttype: ["Appointment"],
  preferreddatetime: ["Appointment"],
  arrivaldatetime: ["Appointment"],
  // Item master
  primarybarcode: ["Item"],
  description: ["Item", "Order"],
  productclass: ["Item"],
  unitprice: ["Item", "Order"],
  trackitemattribute1: ["Item"],
  trackitemattribute2: ["Item"],
  trackitemattribute3: ["Item"],
  trackitemattribute4: ["Item"],
  trackitemattribute5: ["Item"],
  trackbatchnumber: ["Item"],
  // Quantities
  shippedquantity: ["ASN", "PO", "Order"],
  orderedquantity: ["Order", "PO"],
  pickedquantity: ["oLPN"],
  packedquantity: ["oLPN", "Order"],
  allocatedquantity: ["Order", "iLPN"],
};

let _inventoryCache = null;
let _inventoryPromise = null;

function escapeRb(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveFieldObjects(attributeName) {
  if (!attributeName) return [];
  const key = String(attributeName).toLowerCase();
  if (FIELD_OBJECTS[key]) return FIELD_OBJECTS[key].slice();
  // Pattern families
  if (/^inventoryattribute[1-5]$/i.test(key)) return ["ASN", "PO", "iLPN"];
  if (/^itemattribute[1-5]$/i.test(key)) return ["Order", "oLPN"];
  if (/^trackitemattribute[1-5]$/i.test(key)) return ["Item"];
  if (/^allowmixinginventoryattr[1-5]$/i.test(key)) return ["Location"];
  return [];
}

function displayLabelForAttr(a) {
  const objects = a.objects?.length ? a.objects : resolveFieldObjects(a.attribute);
  const name = a.attribute || a.key;
  if (objects.length) return `${name} — ${objects.join(", ")}`;
  return String(name);
}

function enrichInventory(inventory) {
  const attrs = inventory?.billingIndex?.attributes || [];
  for (const a of attrs) {
    const objects = resolveFieldObjects(a.attribute);
    a.objects = objects;
    if (!a.entity || a.entity === "unknown" || a.entity === "None") {
      a.entity = objects[0] || "";
    }
    a.label = displayLabelForAttr(a);
    // Rebuild key for UI uniqueness but keep original key if present
    if (!a.key || a.key.includes(".unknown.")) {
      a.key = `${a.component}.${(a.entity || "field").toLowerCase()}.${a.attribute}`.toLowerCase();
    }
  }
  return inventory;
}

async function loadInventory() {
  if (_inventoryCache) return _inventoryCache;
  if (_inventoryPromise) return _inventoryPromise;
  _inventoryPromise = fetch("/data/rule_inventory/rule_inventory.json")
    .then(async (res) => {
      if (!res.ok) throw new Error(`Inventory HTTP ${res.status}`);
      const data = enrichInventory(await res.json());
      _inventoryCache = data;
      return data;
    })
    .catch((err) => {
      _inventoryPromise = null;
      console.warn("[rule-builder] inventory load failed", err);
      return enrichInventory({
        billingIndex: { byActivityHint: {}, attributes: [] },
        components: [],
        note: String(err.message || err),
      });
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
      const hay = `${a.attribute || ""} ${a.label || ""} ${(a.objects || []).join(" ")} ${a.key || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }
  // Prefer enriched / known fields first when browsing without search
  if (!q) {
    attrs = [...attrs].sort((a, b) => {
      const ae = a.objects?.length ? 0 : 1;
      const be = b.objects?.length ? 0 : 1;
      if (ae !== be) return ae - be;
      return String(a.attribute || "").localeCompare(String(b.attribute || ""));
    });
  }
  return attrs.slice(0, 300);
}

function opNeedsValue(op) {
  return !VALUELESS_OPS.has(op);
}

function summarizeCondition(c) {
  const left = c.attribute || "?";
  const op = RULE_BUILDER_OPS.find((o) => o.id === c.operator)?.label || c.operator;
  if (!opNeedsValue(c.operator)) return `${left} ${op}`;
  const val = c.value == null || c.value === "" ? "…" : c.value;
  return `${left} ${op} ${val}`;
}

function summarizeBranch(branch) {
  const conds = branch?.match?.conditions || [];
  const logic = (branch?.match?.logic || "and").toUpperCase();
  const matchText = conds.length
    ? conds.map(summarizeCondition).join(` ${logic} `)
    : "(no conditions)";
  const charge = branch?.charge || {};
  const rateNum = Number(charge.rate || 0);
  const rate =
    charge.type === "fixed"
      ? `$${rateNum.toFixed(2)} fixed`
      : `$${rateNum.toFixed(2)} / unit`;
  return `If ${matchText} → ${rate}`;
}

function defaultBranch() {
  return {
    id: uid("br"),
    label: "",
    match: {
      logic: "and",
      conditions: [{ attribute: "", operator: "eq", value: "", objects: [] }],
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

function attrOptionsFor(inventory, component, selectedAttr, query) {
  const attrs = filterAttributes(inventory, { component, query: query || "" });
  const opts = [`<option value="">— select attribute —</option>`];
  let matched = false;
  for (const a of attrs) {
    const sel = a.attribute === selectedAttr;
    if (sel) matched = true;
    const objects = (a.objects || []).join(",");
    opts.push(
      `<option value="${escapeRb(a.key)}" data-attribute="${escapeRb(a.attribute || "")}" data-objects="${escapeRb(objects)}"${sel ? " selected" : ""}>${escapeRb(displayLabelForAttr(a))}</option>`
    );
  }
  if (selectedAttr && !matched) {
    const objects = resolveFieldObjects(selectedAttr);
    const key = `custom.field.${selectedAttr}`;
    opts.push(
      `<option value="${escapeRb(key)}" data-attribute="${escapeRb(selectedAttr)}" data-objects="${escapeRb(objects.join(","))}" selected>${escapeRb(displayLabelForAttr({ attribute: selectedAttr, objects }))}</option>`
    );
  }
  return opts.join("");
}

function renderConditionRow(cond, inventory, component) {
  const needsVal = opNeedsValue(cond.operator || "eq");
  const opOpts = RULE_BUILDER_OPS.map(
    (o) =>
      `<option value="${o.id}"${(cond.operator || "eq") === o.id ? " selected" : ""}>${escapeRb(o.label)}</option>`
  ).join("");
  const attrHtml = attrOptionsFor(inventory, component, cond.attribute, "");
  return `<div class="rb-condition" data-role="condition">
    <div class="rb-attr-picker">
      <input class="form-control form-control-sm" data-field="attrSearch" type="search" placeholder="Search attributes…" autocomplete="off" />
      <select class="form-select form-select-sm" data-field="attributeKey">${attrHtml}</select>
    </div>
    <select class="form-select form-select-sm" data-field="operator">${opOpts}</select>
    <input class="form-control form-control-sm" data-field="value" placeholder="value" value="${escapeRb(cond.value ?? "")}" ${needsVal ? "" : "disabled"} />
    <button type="button" class="btn btn-link btn-sm text-danger" data-action="remove-condition" title="Remove condition">&times;</button>
  </div>`;
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
        .map((c) => renderConditionRow(c, inventory, component))
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
        <p class="rb-preview small text-muted mb-0 mt-2" data-role="preview">${escapeRb(summarizeBranch(branch))}</p>
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
      <p class="small text-muted mb-2">Pick an attribute, set a match and rate. First matching branch wins; optional default/else below. <span class="rb-inv-meta">${escapeRb(crawled)}</span></p>
      <div class="row g-2 align-items-end mb-2">
        <div class="col-md-6">
          <label class="form-label mb-0 small">Attribute source (component)</label>
          <select class="form-select form-select-sm" data-field="component">${compOpts || '<option value="receiving">receiving</option>'}</select>
        </div>
        <div class="col-md-3">
          <button type="button" class="btn btn-outline-primary btn-sm w-100" data-action="add-branch">+ branch</button>
        </div>
      </div>
    </div>
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
  let attribute = "";
  let objects = [];
  if (opt && opt.value) {
    attribute = opt.dataset.attribute || "";
    objects = (opt.dataset.objects || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!attribute && attrSel?.value) {
    const parts = attrSel.value.split(".");
    attribute = parts[parts.length - 1] || "";
    objects = resolveFieldObjects(attribute);
  }
  if (!objects.length && attribute) objects = resolveFieldObjects(attribute);
  const value = opNeedsValue(op) ? el.querySelector('[data-field="value"]')?.value ?? "" : null;
  return {
    attribute,
    objects,
    entity: objects[0] || "",
    operator: op,
    value,
  };
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
      if (c.attribute) conditions.push(c);
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

function refreshBranchPreview(branchEl) {
  const preview = branchEl.querySelector('[data-role="preview"]');
  if (!preview) return;
  const conditions = [];
  branchEl.querySelectorAll('[data-role="condition"]').forEach((cEl) => {
    const c = readConditionEl(cEl);
    if (c.attribute) conditions.push(c);
    else conditions.push({ attribute: "…", operator: c.operator, value: c.value });
  });
  const rateRaw = branchEl.querySelector('[data-field="rate"]')?.value;
  const branch = {
    match: {
      logic: branchEl.querySelector('[data-field="logic"]')?.value || "and",
      conditions,
    },
    charge: {
      type: branchEl.querySelector('[data-field="chargeType"]')?.value || "per",
      rate: rateRaw === "" || rateRaw == null ? 0 : Number(rateRaw),
    },
  };
  preview.textContent = summarizeBranch(branch);
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

  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches('[data-field="attrSearch"]')) {
      const row = t.closest('[data-role="condition"]');
      const sel = row?.querySelector('[data-field="attributeKey"]');
      const component = root.querySelector('[data-field="component"]')?.value || "receiving";
      const selectedAttr = sel?.selectedOptions?.[0]?.dataset?.attribute || "";
      if (sel) {
        sel.innerHTML = attrOptionsFor(inventory, component, selectedAttr, t.value);
      }
      return;
    }
    const branchEl = t.closest('[data-role="branch"]');
    if (branchEl && (t.matches('[data-field="value"]') || t.matches('[data-field="rate"]') || t.matches('[data-field="label"]'))) {
      refreshBranchPreview(branchEl);
    }
  });

  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches('[data-field="operator"]')) {
      const row = t.closest('[data-role="condition"]');
      const val = row?.querySelector('[data-field="value"]');
      if (val) val.disabled = !opNeedsValue(t.value);
    }
    if (t.matches('[data-field="component"]')) {
      rerender();
      return;
    }
    const branchEl = t.closest('[data-role="branch"]');
    if (
      branchEl &&
      (t.matches('[data-field="attributeKey"]') ||
        t.matches('[data-field="operator"]') ||
        t.matches('[data-field="logic"]') ||
        t.matches('[data-field="chargeType"]') ||
        t.matches('[data-field="rate"]') ||
        t.matches('[data-field="value"]'))
    ) {
      refreshBranchPreview(branchEl);
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
          attribute: "",
          operator: "eq",
          value: "",
          objects: [],
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
            attribute: "",
            operator: "eq",
            value: "",
            objects: [],
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
  resolveFieldObjects,
};

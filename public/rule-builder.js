/** Billingmgmt — rule builder using MAWM object field catalogs (Charge Column + conditions). */

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

let _catalogCache = null;
let _catalogPromise = null;

function escapeRb(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadFieldCatalog() {
  if (_catalogCache) return _catalogCache;
  if (_catalogPromise) return _catalogPromise;
  _catalogPromise = fetch("/data/field_catalog/index.json")
    .then(async (res) => {
      if (!res.ok) throw new Error(`Field catalog HTTP ${res.status}`);
      _catalogCache = await res.json();
      return _catalogCache;
    })
    .catch((err) => {
      _catalogPromise = null;
      console.warn("[rule-builder] field catalog load failed", err);
      return { domains: {}, attributes: [], objects: {}, note: String(err.message || err) };
    });
  return _catalogPromise;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function domainList(catalog) {
  return Object.entries(catalog.domains || {}).map(([id, d]) => ({
    id,
    label: d.label || id,
    objects: d.objects || [],
    suggestedChargeColumns: d.suggestedChargeColumns || [],
  }));
}

function attrsForDomain(catalog, domainId, { chargeColumnsOnly = false, query = "" } = {}) {
  const domain = catalog.domains?.[domainId];
  const allowed = new Set(domain?.objects || []);
  let attrs = (catalog.attributes || []).filter((a) => !allowed.size || allowed.has(a.object));
  if (chargeColumnsOnly) {
    const suggested = new Set(
      (domain?.suggestedChargeColumns || []).map((c) => `${c.object}.${c.path}`.toLowerCase())
    );
    attrs = attrs.filter((a) => a.chargeColumnCandidate || suggested.has(a.key));
  }
  const q = (query || "").trim().toLowerCase();
  if (q) {
    attrs = attrs.filter((a) => {
      const hay = `${a.label} ${a.path} ${a.object} ${a.objectLabel}`.toLowerCase();
      return hay.includes(q);
    });
  }
  return [...attrs].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

function opNeedsValue(op) {
  return !VALUELESS_OPS.has(op);
}

function fieldLabel(objectLabel, path) {
  return `${objectLabel}.${String(path || "").replaceAll("[]", "")}`;
}

function summarizeCondition(c) {
  const left = c.label || (c.object && c.path ? `${c.object}.${c.path}` : c.attribute || "…");
  const op = RULE_BUILDER_OPS.find((o) => o.id === c.operator)?.label || c.operator;
  if (!opNeedsValue(c.operator)) return `${left} ${op}`;
  const val = c.value == null || c.value === "" ? "…" : c.value;
  return `${left} ${op} ${val}`;
}

function summarizeBranch(branch) {
  const conds = branch?.match?.conditions || [];
  const logic = (branch?.match?.logic || "and").toUpperCase();
  const matchText = conds.length ? conds.map(summarizeCondition).join(` ${logic} `) : "(no conditions)";
  const charge = branch?.charge || {};
  const rateNum = Number(charge.rate || 0);
  const rate = charge.type === "fixed" ? `$${rateNum.toFixed(2)} fixed` : `$${rateNum.toFixed(2)} / unit`;
  return `If ${matchText} → ${rate}`;
}

function defaultBranch() {
  return {
    id: uid("br"),
    label: "",
    match: {
      logic: "and",
      conditions: [{ object: "", path: "", label: "", operator: "eq", value: "" }],
    },
    charge: { type: "per", rate: 0 },
  };
}

function ensureRuleExtras(record, catalog) {
  const next = { ...(record || {}) };
  const domains = domainList(catalog);
  const defaultDomain = next.attributeSource?.domain || domains[0]?.id || "receiving";
  if (!next.attributeSource) next.attributeSource = { domain: defaultDomain };
  if (!next.attributeSource.domain) next.attributeSource.domain = defaultDomain;
  if (!next.chargeColumn) {
    const sug = catalog.domains?.[defaultDomain]?.suggestedChargeColumns?.[0];
    next.chargeColumn = sug
      ? { object: sug.object, path: sug.path }
      : { object: "", path: "" };
  }
  if (!Array.isArray(next.branches) || !next.branches.length) {
    next.branches = [defaultBranch()];
  }
  if (!next.defaultCharge) next.defaultCharge = { type: "per", rate: 0 };
  return next;
}

function renderComboListHtml(items, selectedKey) {
  if (!items.length) return `<li class="rb-combo-empty">No matching fields</li>`;
  return items
    .map((item) => {
      const selected = item.key === selectedKey;
      return `<li class="rb-combo-option${selected ? " is-selected" : ""}" role="option" data-key="${escapeRb(item.key)}" data-object="${escapeRb(item.object)}" data-path="${escapeRb(item.path)}" data-label="${escapeRb(item.label)}">${escapeRb(item.label)}</li>`;
    })
    .join("");
}

function renderCombobox({ role, selected, items, placeholder }) {
  const key = selected?.key || (selected?.object && selected?.path ? `${selected.object}.${selected.path}`.toLowerCase() : "");
  const label =
    selected?.label ||
    (selected?.object && selected?.path
      ? fieldLabel(selected.objectLabel || selected.object, selected.path)
      : placeholder);
  const objects = selected?.object || "";
  const path = selected?.path || "";
  return `<div class="rb-combobox" data-role="${role}" data-key="${escapeRb(key)}" data-object="${escapeRb(objects)}" data-path="${escapeRb(path)}" data-label="${escapeRb(label)}">
    <button type="button" class="rb-combo-trigger form-select form-select-sm text-start" data-action="toggle-combo" aria-haspopup="listbox" aria-expanded="false">
      <span class="rb-combo-label">${escapeRb(label)}</span>
    </button>
    <div class="rb-combo-panel" hidden>
      <input type="search" class="rb-combo-search form-control form-control-sm" placeholder="Search" data-field="attrSearch" autocomplete="off" />
      <ul class="rb-combo-list" role="listbox">${renderComboListHtml(items, key)}</ul>
    </div>
  </div>`;
}

function findAttr(catalog, object, path) {
  if (!object || !path) return null;
  const key = `${object}.${path}`.toLowerCase();
  return (catalog.attributes || []).find((a) => a.key === key) || {
    key,
    object,
    path,
    label: fieldLabel(object, path),
    objectLabel: object,
  };
}

function renderConditionRow(cond, catalog, domainId) {
  const needsVal = opNeedsValue(cond.operator || "eq");
  const opOpts = RULE_BUILDER_OPS.map(
    (o) =>
      `<option value="${o.id}"${(cond.operator || "eq") === o.id ? " selected" : ""}>${escapeRb(o.label)}</option>`
  ).join("");
  const selected = cond.object && cond.path ? findAttr(catalog, cond.object, cond.path) : null;
  const items = attrsForDomain(catalog, domainId, { chargeColumnsOnly: false });
  return `<div class="rb-condition" data-role="condition">
    ${renderCombobox({
      role: "attr-combobox",
      selected,
      items,
      placeholder: "— select attribute —",
    })}
    <select class="form-select form-select-sm" data-field="operator">${opOpts}</select>
    <input class="form-control form-control-sm" data-field="value" placeholder="value" value="${escapeRb(cond.value ?? "")}" ${needsVal ? "" : "disabled"} />
    <button type="button" class="btn btn-link btn-sm text-danger" data-action="remove-condition" title="Remove condition">&times;</button>
  </div>`;
}

function renderBuilderHtml(record, catalog, { showBranches }) {
  const shaped = ensureRuleExtras(record, catalog);
  const domainId = shaped.attributeSource.domain;
  const domains = domainList(catalog);
  const domainOpts = domains
    .map((d) => `<option value="${escapeRb(d.id)}"${d.id === domainId ? " selected" : ""}>${escapeRb(d.label)}</option>`)
    .join("");

  const chargeSelected = findAttr(catalog, shaped.chargeColumn?.object, shaped.chargeColumn?.path);
  const chargeItems = attrsForDomain(catalog, domainId, { chargeColumnsOnly: true });

  let branchHtml = "";
  if (showBranches) {
    branchHtml = shaped.branches
      .map((branch, idx) => {
        const condHtml = (branch.match?.conditions || [])
          .map((c) => renderConditionRow(c, catalog, domainId))
          .join("");
        const chargeType = branch.charge?.type || "per";
        return `<div class="rb-branch card-panel" data-role="branch" data-branch-id="${escapeRb(branch.id)}">
          <div class="rb-branch-head">
            <strong>Branch ${idx + 1}</strong>
            <input class="form-control form-control-sm rb-branch-label" data-field="label" placeholder="Label (optional)" value="${escapeRb(branch.label || "")}" />
            <select class="form-select form-select-sm" data-field="logic">
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
  }

  const defType = shaped.defaultCharge?.type || "per";
  const meta = `${(catalog.attributes || []).length} catalog fields`;

  return `<div class="rule-builder" data-role="rule-builder">
    <div class="rb-header">
      <h6 class="mb-1">Billing rule fields</h6>
      <p class="small text-muted mb-2">Charge Column is what to count/group (legacy BM). Conditions use the same WM object fields. <span class="rb-inv-meta">${escapeRb(meta)}</span></p>
      <div class="row g-2 align-items-end mb-2">
        <div class="col-md-4">
          <label class="form-label mb-0 small">Billing domain</label>
          <select class="form-select form-select-sm" data-field="domain">${domainOpts}</select>
        </div>
        <div class="col-md-8">
          <label class="form-label mb-0 small">Charge Column</label>
          ${renderCombobox({
            role: "charge-column-combobox",
            selected: chargeSelected,
            items: chargeItems,
            placeholder: "— select charge column —",
          })}
        </div>
      </div>
      ${
        showBranches
          ? `<div class="mb-2"><button type="button" class="btn btn-outline-primary btn-sm" data-action="add-branch">+ branch</button></div>`
          : ""
      }
    </div>
    ${showBranches ? `<div class="rb-branches" data-role="branches">${branchHtml}</div>` : ""}
    ${
      showBranches
        ? `<div class="rb-default card-panel mt-2">
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
    </div>`
        : ""
    }
  </div>`;
}

function readCombobox(el) {
  if (!el) return { object: "", path: "", label: "", key: "" };
  return {
    object: el.dataset.object || "",
    path: el.dataset.path || "",
    label: el.dataset.label || "",
    key: el.dataset.key || "",
  };
}

function readConditionEl(el) {
  const op = el.querySelector('[data-field="operator"]')?.value || "eq";
  const combo = readCombobox(el.querySelector('[data-role="attr-combobox"]'));
  const value = opNeedsValue(op) ? el.querySelector('[data-field="value"]')?.value ?? "" : null;
  return {
    object: combo.object,
    path: combo.path,
    label: combo.label,
    attribute: combo.path,
    operator: op,
    value,
  };
}

function collectFromHost(host) {
  if (!host) return null;
  const root = host.querySelector('[data-role="rule-builder"]');
  if (!root) return null;
  const domain = root.querySelector('[data-field="domain"]')?.value || "receiving";
  const chargeCol = readCombobox(root.querySelector('[data-role="charge-column-combobox"]'));
  const branches = [];
  root.querySelectorAll('[data-role="branch"]').forEach((branchEl) => {
    const conditions = [];
    branchEl.querySelectorAll('[data-role="condition"]').forEach((cEl) => {
      const c = readConditionEl(cEl);
      if (c.object && c.path) conditions.push(c);
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
  const out = {
    attributeSource: { domain, primaryObject: null },
    chargeColumn: { object: chargeCol.object, path: chargeCol.path },
  };
  if (branches.length) {
    out.branches = branches;
    out.defaultCharge = {
      type: root.querySelector('[data-field="defaultChargeType"]')?.value || "per",
      rate: defRate === "" || defRate == null ? 0 : Number(defRate),
    };
  }
  return out;
}

function refreshBranchPreview(branchEl) {
  const preview = branchEl.querySelector('[data-role="preview"]');
  if (!preview) return;
  const conditions = [];
  branchEl.querySelectorAll('[data-role="condition"]').forEach((cEl) => {
    const c = readConditionEl(cEl);
    conditions.push(c.object && c.path ? c : { label: "…", operator: c.operator, value: c.value });
  });
  const rateRaw = branchEl.querySelector('[data-field="rate"]')?.value;
  preview.textContent = summarizeBranch({
    match: {
      logic: branchEl.querySelector('[data-field="logic"]')?.value || "and",
      conditions,
    },
    charge: {
      type: branchEl.querySelector('[data-field="chargeType"]')?.value || "per",
      rate: rateRaw === "" || rateRaw == null ? 0 : Number(rateRaw),
    },
  });
}

function closeAllComboboxes(except) {
  document.querySelectorAll(".rb-combobox.is-open").forEach((box) => {
    if (except && box === except) return;
    box.classList.remove("is-open");
    const panel = box.querySelector(".rb-combo-panel");
    const trigger = box.querySelector(".rb-combo-trigger");
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}

function openCombobox(box, catalog, domainId) {
  closeAllComboboxes(box);
  const panel = box.querySelector(".rb-combo-panel");
  const list = box.querySelector(".rb-combo-list");
  const search = box.querySelector('[data-field="attrSearch"]');
  const trigger = box.querySelector(".rb-combo-trigger");
  if (!panel || !list) return;
  const chargeOnly = box.dataset.role === "charge-column-combobox";
  const items = attrsForDomain(catalog, domainId, { chargeColumnsOnly: chargeOnly, query: "" });
  list.innerHTML = renderComboListHtml(items, box.dataset.key || "");
  panel.hidden = false;
  box.classList.add("is-open");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  if (search) {
    search.value = "";
    setTimeout(() => search.focus(), 0);
  }
}

function bindBuilder(host, catalog, recordRef, showBranches) {
  const root = host.querySelector('[data-role="rule-builder"]');
  if (!root) return;
  const getDomain = () => root.querySelector('[data-field="domain"]')?.value || "receiving";

  const rerender = () => {
    const collected = collectFromHost(host) || ensureRuleExtras(recordRef, catalog);
    Object.assign(recordRef, collected);
    host.innerHTML = renderBuilderHtml(recordRef, catalog, { showBranches });
    bindBuilder(host, catalog, recordRef, showBranches);
  };

  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches('[data-field="attrSearch"]')) {
      const box = t.closest(".rb-combobox");
      const list = box?.querySelector(".rb-combo-list");
      if (!list) return;
      const chargeOnly = box.dataset.role === "charge-column-combobox";
      list.innerHTML = renderComboListHtml(
        attrsForDomain(catalog, getDomain(), { chargeColumnsOnly: chargeOnly, query: t.value }),
        box.dataset.key || ""
      );
      return;
    }
    const branchEl = t.closest('[data-role="branch"]');
    if (branchEl && (t.matches('[data-field="value"]') || t.matches('[data-field="rate"]') || t.matches('[data-field="label"]'))) {
      refreshBranchPreview(branchEl);
    }
  });

  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches('[data-field="domain"]')) {
      // Reset charge column suggestion for new domain
      const sug = catalog.domains?.[t.value]?.suggestedChargeColumns?.[0];
      if (sug) recordRef.chargeColumn = { object: sug.object, path: sug.path };
      recordRef.attributeSource = { ...(recordRef.attributeSource || {}), domain: t.value };
      rerender();
      return;
    }
    if (t.matches('[data-field="operator"]')) {
      const row = t.closest('[data-role="condition"]');
      const val = row?.querySelector('[data-field="value"]');
      if (val) val.disabled = !opNeedsValue(t.value);
    }
    const branchEl = t.closest('[data-role="branch"]');
    if (
      branchEl &&
      (t.matches('[data-field="operator"]') ||
        t.matches('[data-field="logic"]') ||
        t.matches('[data-field="chargeType"]') ||
        t.matches('[data-field="rate"]') ||
        t.matches('[data-field="value"]'))
    ) {
      refreshBranchPreview(branchEl);
    }
  });

  root.addEventListener("click", (e) => {
    const option = e.target.closest(".rb-combo-option");
    if (option) {
      e.preventDefault();
      const box = option.closest(".rb-combobox");
      const branchEl = option.closest('[data-role="branch"]');
      if (box) {
        box.dataset.key = option.dataset.key || "";
        box.dataset.object = option.dataset.object || "";
        box.dataset.path = option.dataset.path || "";
        box.dataset.label = option.dataset.label || "";
        const labelEl = box.querySelector(".rb-combo-label");
        if (labelEl) labelEl.textContent = option.dataset.label || option.textContent;
        closeAllComboboxes();
        if (branchEl) refreshBranchPreview(branchEl);
      }
      return;
    }

    const toggle = e.target.closest('[data-action="toggle-combo"]');
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const box = toggle.closest(".rb-combobox");
      if (!box) return;
      if (box.classList.contains("is-open")) closeAllComboboxes();
      else openCombobox(box, catalog, getDomain());
      return;
    }

    if (!showBranches) return;
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const current = collectFromHost(host) || ensureRuleExtras(recordRef, catalog);
    if (!current.branches) current.branches = [defaultBranch()];

    if (action === "add-branch") current.branches.push(defaultBranch());
    else if (action === "remove-branch") {
      const id = btn.closest('[data-role="branch"]')?.dataset.branchId;
      current.branches = current.branches.filter((b) => b.id !== id);
      if (!current.branches.length) current.branches = [defaultBranch()];
    } else if (action === "add-condition") {
      const id = btn.closest('[data-role="branch"]')?.dataset.branchId;
      const branch = current.branches.find((b) => b.id === id);
      if (branch) {
        branch.match.conditions.push({ object: "", path: "", label: "", operator: "eq", value: "" });
      }
    } else if (action === "remove-condition") {
      const branchEl = btn.closest('[data-role="branch"]');
      const condEl = btn.closest('[data-role="condition"]');
      const branch = current.branches.find((b) => b.id === branchEl?.dataset.branchId);
      if (branch && condEl) {
        const idx = [...branchEl.querySelectorAll('[data-role="condition"]')].indexOf(condEl);
        if (idx >= 0) branch.match.conditions.splice(idx, 1);
        if (!branch.match.conditions.length) {
          branch.match.conditions.push({ object: "", path: "", label: "", operator: "eq", value: "" });
        }
      }
    } else return;

    Object.assign(recordRef, current);
    host.innerHTML = renderBuilderHtml(recordRef, catalog, { showBranches: true });
    bindBuilder(host, catalog, recordRef, true);
  });

  if (!host._rbDocCloseBound) {
    host._rbDocCloseBound = true;
    document.addEventListener("click", (ev) => {
      if (!ev.target.closest(".rb-combobox")) closeAllComboboxes();
    });
  }
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

  const catalog = await loadFieldCatalog();
  const working = { ...(record || {}), chargeType: record?.chargeType || "per" };
  const chargeSelect = modalBody.querySelector('[data-key="chargeType"]');

  // Ensure transactionByChargeColumn is available in sum type select
  const sumSelect = modalBody.querySelector('[data-key="chargeSumType"]');
  if (sumSelect && ![...sumSelect.options].some((o) => o.value === "transactionByChargeColumn")) {
    const opt = document.createElement("option");
    opt.value = "transactionByChargeColumn";
    opt.textContent = "transactionByChargeColumn";
    sumSelect.appendChild(opt);
  }

  const sync = () => {
    const ct = chargeSelect?.value || working.chargeType;
    working.chargeType = ct;
    const showBranches = ct === "conditionalPer";
    setSimpleFieldsVisible(modalBody, ct !== "conditionalPer");
    host.style.display = "";
    Object.assign(working, ensureRuleExtras(working, catalog));
    host.innerHTML = renderBuilderHtml(working, catalog, { showBranches });
    bindBuilder(host, catalog, working, showBranches);
  };

  if (chargeSelect && !chargeSelect.dataset.rbBound) {
    chargeSelect.dataset.rbBound = "1";
    chargeSelect.addEventListener("change", sync);
  }
  sync();
  host._rbWorking = working;
}

function applyToRecord(modalBody, record) {
  if (!record) return record;
  const host = modalBody.querySelector("#ruleBuilderHost");
  const collected = collectFromHost(host);
  if (!collected) return record;

  record.attributeSource = collected.attributeSource;
  record.chargeColumn = collected.chargeColumn;
  if (!record.chargeColumn?.object || !record.chargeColumn?.path) {
    throw new Error("Charge Column is required");
  }

  if (record.chargeType === "conditionalPer") {
    if (!collected.branches?.length) throw new Error("Add at least one conditional branch");
    for (const [i, br] of collected.branches.entries()) {
      if (!(br.match?.conditions || []).some((c) => c.object && c.path)) {
        throw new Error(`Branch ${i + 1} needs at least one attribute condition`);
      }
    }
    record.branches = collected.branches;
    record.defaultCharge = collected.defaultCharge;
    record.conditions = [];
    if ("tiers" in record) delete record.tiers;
  } else {
    delete record.branches;
    delete record.defaultCharge;
  }
  return record;
}

function normalizeRuleRecord(record) {
  if (!record || typeof record !== "object") return record;
  if (!record.chargeColumn) record.chargeColumn = { object: "", path: "" };
  if (!record.attributeSource) record.attributeSource = { domain: "receiving" };
  if (record.chargeType === "conditionalPer") {
    if (!Array.isArray(record.branches)) record.branches = [];
    if (!record.defaultCharge) record.defaultCharge = { type: "per", rate: 0 };
  }
  return record;
}

window.BillingRuleBuilder = {
  loadFieldCatalog,
  loadInventory: loadFieldCatalog,
  enhanceEditModal,
  applyToRecord,
  normalizeRuleRecord,
  summarizeBranch,
};

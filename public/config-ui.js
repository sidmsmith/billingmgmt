/** Billingmgmt — table renderers, search, edit modal */

const ENTITY_LABELS = {
  clientActivities: "Client Activity",
  rateCards: "Rate Card",
  rulesTransaction: "Transaction Rule",
  rulesStorage: "Storage Rule",
  billToCodes: "Bill-to Code",
  billingLogDefinitions: "Billing Log Definition",
};

const ENTITY_COLUMNS = {
  clientActivities: [
    { key: "id", label: "ID" },
    { key: "activityType", label: "Type" },
    { key: "activityCode", label: "Code" },
    { key: "billable", label: "Billable", format: "bool" },
    { key: "triggerMode", label: "Trigger" },
    { key: "billToCode", label: "Bill-to" },
  ],
  rateCards: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "uom", label: "UOM" },
    { key: "rate", label: "Rate", format: "number" },
    { key: "glCode", label: "GL Code" },
    { key: "effectiveFrom", label: "From" },
  ],
  rulesTransaction: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "chargeSumType", label: "Sum Type" },
    { key: "chargeType", label: "Charge Type" },
    { key: "priority", label: "Priority" },
    { key: "active", label: "Active", format: "bool" },
  ],
  rulesStorage: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "storageRuleFamily", label: "Family" },
    { key: "chargeSumType", label: "Sum Type" },
    { key: "chargeType", label: "Charge Type" },
    { key: "active", label: "Active", format: "bool" },
  ],
  billToCodes: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "invoiceGroup", label: "Group" },
    { key: "presentationOrder", label: "Order" },
    { key: "active", label: "Active", format: "bool" },
  ],
  billingLogDefinitions: [
    { key: "id", label: "ID" },
    { key: "billToCode", label: "Bill-to" },
    { key: "activityId", label: "Activity" },
    { key: "referenceFields", label: "References", format: "array" },
  ],
};

const ENTITY_FIELDS = {
  clientActivities: [
    { key: "id", label: "ID", required: true },
    { key: "activityType", label: "Activity Type", required: true },
    { key: "activityCode", label: "Activity Code", required: true },
    { key: "description", label: "Description", type: "textarea" },
    { key: "billable", label: "Billable", type: "checkbox" },
    { key: "triggerMode", label: "Trigger Mode", type: "select", options: ["inline", "manual"] },
    { key: "billToCode", label: "Bill-to Code" },
  ],
  rateCards: [
    { key: "id", label: "ID", required: true },
    { key: "name", label: "Name", required: true },
    { key: "uom", label: "UOM", required: true },
    { key: "rate", label: "Rate", type: "number", required: true },
    { key: "glCode", label: "GL Code" },
    { key: "effectiveFrom", label: "Effective From", type: "date" },
    { key: "effectiveTo", label: "Effective To", type: "date" },
  ],
  rulesTransaction: [
    { key: "id", label: "ID", required: true },
    { key: "name", label: "Name", required: true },
    { key: "activityId", label: "Activity ID" },
    { key: "rateCardId", label: "Rate Card ID" },
    { key: "chargeSumType", label: "Charge Sum Type", type: "select", options: ["line", "transaction", "transactionByChargeTag", "activity", "activityByChargeTag"] },
    { key: "chargeType", label: "Charge Type", type: "select", options: ["per", "fixed", "tier", "absoluteTier", "formula", "conditionalPer"] },
    { key: "priority", label: "Priority", type: "number" },
    { key: "minCharge", label: "Min Charge", type: "number" },
    { key: "maxCharge", label: "Max Charge", type: "number" },
    { key: "active", label: "Active", type: "checkbox" },
    { key: "conditions", label: "Conditions (JSON)", type: "json" },
    { key: "tiers", label: "Tiers (JSON)", type: "json" },
  ],
  rulesStorage: [
    { key: "id", label: "ID", required: true },
    { key: "name", label: "Name", required: true },
    { key: "activityId", label: "Activity ID" },
    { key: "rateCardId", label: "Rate Card ID" },
    { key: "storageRuleFamily", label: "Storage Family", type: "select", options: ["snapshot", "average", "anniversaryRetroactive", "anniversaryAdvanced"] },
    { key: "chargeSumType", label: "Charge Sum Type", type: "select", options: ["line", "transaction", "transactionByChargeTag"] },
    { key: "chargeType", label: "Charge Type", type: "select", options: ["per", "fixed", "tier", "formula", "conditionalPer"] },
    { key: "snapshotDay", label: "Snapshot Day", type: "number" },
    { key: "priority", label: "Priority", type: "number" },
    { key: "minCharge", label: "Min Charge", type: "number" },
    { key: "maxCharge", label: "Max Charge", type: "number" },
    { key: "active", label: "Active", type: "checkbox" },
  ],
  billToCodes: [
    { key: "id", label: "ID", required: true },
    { key: "name", label: "Name", required: true },
    { key: "invoiceGroup", label: "Invoice Group" },
    { key: "presentationOrder", label: "Presentation Order", type: "number" },
    { key: "taxPercent", label: "Tax %", type: "number" },
    { key: "active", label: "Active", type: "checkbox" },
  ],
  billingLogDefinitions: [
    { key: "id", label: "ID", required: true },
    { key: "billToCode", label: "Bill-to Code", required: true },
    { key: "activityId", label: "Activity ID", required: true },
    { key: "referenceFields", label: "Reference Fields (comma-separated)" },
  ],
};

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCell(value, format) {
  if (format === "bool") {
    const on = value === true || value === "true";
    return `<span class="${on ? "badge-active" : "badge-inactive"}">${on ? "Yes" : "No"}</span>`;
  }
  if (format === "number") {
    return value == null || value === "" ? "—" : escapeHtml(value);
  }
  if (format === "array") {
    if (!Array.isArray(value)) return "—";
    return escapeHtml(value.join(", "));
  }
  return escapeHtml(value ?? "—");
}

function recordMatchesSearch(record, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return Object.values(record).some((v) => {
    if (v == null) return false;
    if (Array.isArray(v)) return v.join(" ").toLowerCase().includes(q);
    if (typeof v === "object") return JSON.stringify(v).toLowerCase().includes(q);
    return String(v).toLowerCase().includes(q);
  });
}

function renderEntityTable(entityKey, records, query, handlers) {
  const cols = ENTITY_COLUMNS[entityKey] || [];
  const filtered = (records || []).filter((r) => recordMatchesSearch(r, query));

  if (!filtered.length) {
    return `<p class="text-muted mb-0">No ${ENTITY_LABELS[entityKey] || entityKey} records for this scope.</p>`;
  }

  const head = cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("") + "<th>Actions</th>";
  const rows = filtered
    .map((record) => {
      const cells = cols.map((c) => `<td>${formatCell(record[c.key], c.format)}</td>`).join("");
      return `<tr data-id="${escapeHtml(record.id)}">
        ${cells}
        <td class="row-actions">
          <button type="button" class="btn btn-link btn-sm edit-row-btn" data-id="${escapeHtml(record.id)}">Edit</button>
          <button type="button" class="btn btn-link btn-sm text-danger delete-row-btn" data-id="${escapeHtml(record.id)}">Delete</button>
        </td>
      </tr>`;
    })
    .join("");

  return `<div class="table-responsive">
    <table class="table table-sm billing-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function bindTableActions(host, handlers) {
  host.querySelectorAll(".edit-row-btn").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onEdit(btn.dataset.id));
  });
  host.querySelectorAll(".delete-row-btn").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onDelete(btn.dataset.id));
  });
}

function buildEditForm(entityKey, record) {
  const fields = ENTITY_FIELDS[entityKey] || [];
  return fields
    .map((field) => {
      const id = `fld-${field.key}`;
      const val = record?.[field.key];
      if (field.type === "checkbox") {
        const checked = val === true || val === "true" ? " checked" : "";
        return `<div class="form-check mb-2">
          <input class="form-check-input" type="checkbox" id="${id}" data-key="${field.key}"${checked} />
          <label class="form-check-label" for="${id}">${escapeHtml(field.label)}</label>
        </div>`;
      }
      if (field.type === "textarea") {
        return `<div class="mb-2">
          <label class="form-label" for="${id}">${escapeHtml(field.label)}</label>
          <textarea class="form-control" id="${id}" data-key="${field.key}" rows="2">${escapeHtml(val ?? "")}</textarea>
        </div>`;
      }
      if (field.type === "select") {
        const opts = (field.options || [])
          .map((o) => {
            const sel = String(val) === o ? " selected" : "";
            return `<option value="${escapeHtml(o)}"${sel}>${escapeHtml(o)}</option>`;
          })
          .join("");
        return `<div class="mb-2">
          <label class="form-label" for="${id}">${escapeHtml(field.label)}</label>
          <select class="form-select" id="${id}" data-key="${field.key}">${opts}</select>
        </div>`;
      }
      if (field.type === "json") {
        const jsonVal = val != null ? JSON.stringify(val, null, 2) : "";
        return `<div class="mb-2">
          <label class="form-label" for="${id}">${escapeHtml(field.label)}</label>
          <textarea class="form-control font-monospace" id="${id}" data-key="${field.key}" data-json="1" rows="4">${escapeHtml(jsonVal)}</textarea>
        </div>`;
      }
      const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
      return `<div class="mb-2">
        <label class="form-label" for="${id}">${escapeHtml(field.label)}</label>
        <input class="form-control" type="${inputType}" id="${id}" data-key="${field.key}" value="${escapeHtml(val ?? "")}" />
      </div>`;
    })
    .join("");
}

function readEditForm(modalBody, entityKey) {
  const fields = ENTITY_FIELDS[entityKey] || [];
  const record = {};
  for (const field of fields) {
    const el = modalBody.querySelector(`[data-key="${field.key}"]`);
    if (!el) continue;
    if (field.type === "checkbox") {
      record[field.key] = el.checked;
    } else if (field.type === "json") {
      const raw = el.value.trim();
      if (!raw) {
        record[field.key] = [];
      } else {
        record[field.key] = JSON.parse(raw);
      }
    } else if (field.type === "number") {
      const n = el.value.trim();
      record[field.key] = n === "" ? null : Number(n);
    } else if (field.key === "referenceFields") {
      record[field.key] = el.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      const v = el.value.trim();
      record[field.key] = v === "" ? null : v;
    }
  }
  for (const field of fields) {
    if (field.required && !record[field.key] && record[field.key] !== false) {
      throw new Error(`${field.label} is required`);
    }
  }
  return record;
}

function newRecordId(entityKey) {
  const prefix = entityKey.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
  return `${prefix}-${Date.now().toString(36)}`;
}

window.BillingUI = {
  ENTITY_LABELS,
  ENTITY_COLUMNS,
  ENTITY_FIELDS,
  renderEntityTable,
  bindTableActions,
  buildEditForm,
  readEditForm,
  newRecordId,
};

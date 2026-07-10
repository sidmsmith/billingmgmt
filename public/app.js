/** Billingmgmt — auth, scope, config editing */

const APP_VERSION = "0.1.0";
const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const state = {
  token: null,
  org: null,
  scopeHierarchy: null,
  orgDraft: { version: "1.0.0", facilities: [] },
  defaultConfig: null,
  activeEntity: "clientActivities",
  searchQuery: "",
  editingRecordId: null,
  editModal: null,
};

let orgInput, authBtn, orgSection, mainUI, statusEl;
let facilitySelect, buSelect, clientSelect;
let saveBtn, tableHost, searchInput, addRecordBtn;
let editModalEl, editModalBody, editModalTitle, editModalSave;

function setStatus(msg, type = "", timeoutMs = 0) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = "app-status";
  if (type === "success") statusEl.classList.add("text-success");
  if (type === "danger" || type === "error") statusEl.classList.add("text-danger");
  if (type === "warning") statusEl.classList.add("text-warning");
  if (timeoutMs > 0) {
    setTimeout(() => {
      if (statusEl.textContent === msg) {
        statusEl.textContent = "";
        statusEl.className = "app-status";
      }
    }, timeoutMs);
  }
}

async function api(action, body, showStatus = false) {
  try {
    const res = await fetch("/api/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let result;
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      return { success: false, error: `API returned non-JSON (${res.status})` };
    }
    if (!res.ok && result.success !== false) {
      result.success = false;
      result.error = result.error || `HTTP ${res.status}`;
    }
    if (showStatus && !result.success) {
      setStatus(result.error || "Request failed", "danger");
    }
    return result;
  } catch (e) {
    if (showStatus) setStatus(e.message, "danger");
    return { success: false, error: e.message };
  }
}

function getOrg() {
  return orgInput.value.trim().toUpperCase();
}

function getScope() {
  return {
    facilityId: facilitySelect?.value || "",
    businessUnitId: buSelect?.value || "",
    clientId: clientSelect?.value || "",
  };
}

function saveScopePrefs() {
  const prefs = BillingAdmin.loadUiPrefs();
  prefs.facilityId = facilitySelect?.value;
  prefs.businessUnitId = buSelect?.value;
  prefs.clientId = clientSelect?.value;
  prefs.activeEntity = state.activeEntity;
  BillingAdmin.saveUiPrefs(prefs);
}

function getUrlParams() {
  return new URLSearchParams(window.location.search);
}

async function trackEvent(eventName, metadata = {}) {
  try {
    await api("usage-track", {
      event_name: eventName,
      metadata: { app_version: APP_VERSION, session_id: sessionId, ...metadata },
    });
  } catch {
    /* non-blocking */
  }
}

function populateSelect(select, items, valueKey = "id", labelFn = null) {
  select.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item[valueKey];
    opt.textContent = labelFn ? labelFn(item) : item.name || item[valueKey];
    select.appendChild(opt);
  }
}

function refreshBusinessUnits() {
  const facId = facilitySelect.value;
  const fac = (state.scopeHierarchy?.facilities || []).find((f) => f.id === facId);
  populateSelect(buSelect, fac?.businessUnits || []);
  refreshClients();
}

function refreshClients() {
  const facId = facilitySelect.value;
  const buId = buSelect.value;
  const fac = (state.scopeHierarchy?.facilities || []).find((f) => f.id === facId);
  const bu = (fac?.businessUnits || []).find((b) => b.id === buId);
  populateSelect(clientSelect, bu?.clients || []);
  saveScopePrefs();
  renderTable();
}

function applyScopePrefs() {
  const prefs = BillingAdmin.loadUiPrefs();
  if (prefs.facilityId && [...facilitySelect.options].some((o) => o.value === prefs.facilityId)) {
    facilitySelect.value = prefs.facilityId;
  }
  refreshBusinessUnits();
  if (prefs.businessUnitId && [...buSelect.options].some((o) => o.value === prefs.businessUnitId)) {
    buSelect.value = prefs.businessUnitId;
  }
  refreshClients();
  if (prefs.clientId && [...clientSelect.options].some((o) => o.value === prefs.clientId)) {
    clientSelect.value = prefs.clientId;
  }
  if (prefs.activeEntity) {
    state.activeEntity = prefs.activeEntity;
    document.querySelectorAll("#entityTabs .nav-link").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.entity === state.activeEntity);
    });
  }
  renderTable();
}

function renderTable() {
  const scope = getScope();
  if (!scope.facilityId || !scope.businessUnitId || !scope.clientId) {
    tableHost.innerHTML = '<p class="text-muted mb-0">Select Facility, Business Unit, and Client.</p>';
    return;
  }
  const records = BillingAdmin.getEntityRecords(state.orgDraft, scope, state.activeEntity);
  tableHost.innerHTML = BillingUI.renderEntityTable(
    state.activeEntity,
    records,
    state.searchQuery,
    {}
  );
  BillingUI.bindTableActions(tableHost, {
    onEdit: (id) => openEditModal(id),
    onDelete: (id) => deleteRecord(id),
  });
}

function openEditModal(recordId) {
  const scope = getScope();
  const records = BillingAdmin.getEntityRecords(state.orgDraft, scope, state.activeEntity);
  const existing = recordId ? records.find((r) => r.id === recordId) : null;
  state.editingRecordId = recordId;
  editModalTitle.textContent = existing
    ? `Edit ${BillingUI.ENTITY_LABELS[state.activeEntity]}`
    : `Add ${BillingUI.ENTITY_LABELS[state.activeEntity]}`;
  editModalBody.innerHTML = BillingUI.buildEditForm(state.activeEntity, existing || { active: true, billable: true });

  const dialog = editModalEl?.querySelector(".modal-dialog");
  if (dialog) {
    const isRule =
      state.activeEntity === "rulesTransaction" || state.activeEntity === "rulesStorage";
    dialog.classList.toggle("modal-xl", isRule);
    dialog.classList.toggle("modal-lg", !isRule);
  }

  if (window.BillingRuleBuilder?.enhanceEditModal) {
    window.BillingRuleBuilder.enhanceEditModal(
      editModalBody,
      state.activeEntity,
      existing || { active: true, chargeType: "per" }
    );
  }

  if (!state.editModal) {
    setStatus("Edit dialog failed to initialize", "danger");
    return;
  }
  state.editModal.show();
}

function saveEditModal() {
  try {
    const record = BillingUI.readEditForm(editModalBody, state.activeEntity);
    if (!record.id) record.id = BillingUI.newRecordId(state.activeEntity);
    if (window.BillingRuleBuilder?.applyToRecord) {
      window.BillingRuleBuilder.applyToRecord(editModalBody, record);
    }
    const scope = getScope();
    BillingAdmin.upsertEntityRecord(state.orgDraft, scope, state.activeEntity, record);
    state.editModal.hide();
    renderTable();
    setStatus("Record saved to local draft", "success", 3000);
  } catch (err) {
    setStatus(err.message || "Validation failed", "danger");
  }
}

function deleteRecord(recordId) {
  if (!window.confirm(`Delete record ${recordId}?`)) return;
  const scope = getScope();
  BillingAdmin.deleteEntityRecord(state.orgDraft, scope, state.activeEntity, recordId);
  renderTable();
  setStatus("Record deleted (local draft)", "warning", 3000);
}

async function loadDefaultConfig() {
  const res = await fetch("/data/defaults/billing.default.json");
  if (!res.ok) throw new Error("Failed to load default config");
  return res.json();
}

async function authenticate() {
  const org = getOrg();
  if (!org) {
    setStatus("ORG required", "danger");
    return;
  }
  authBtn.disabled = true;
  setStatus("Authenticating...");
  const res = await api("auth", { org }, true);
  if (!res.success) {
    authBtn.disabled = false;
    setStatus(res.error || "Auth failed", "danger");
    return;
  }

  state.org = org;
  state.token = res.token;

  try {
    state.defaultConfig = await loadDefaultConfig();
  } catch {
    state.defaultConfig = { version: "1.0.0", facilities: [] };
  }

  const loadRes = await api("load_billing_config", { org, token: state.token });
  if (!loadRes.success) {
    authBtn.disabled = false;
    setStatus(loadRes.error || "Failed to load billing config", "danger");
    return;
  }

  state.orgDraft = BillingAdmin.initOrgDraftFromConfig(loadRes.config);

  const scopeRes = await api("scope", { org, token: state.token });
  if (!scopeRes.success) {
    authBtn.disabled = false;
    setStatus(scopeRes.error || "Failed to load scope", "danger");
    return;
  }
  state.scopeHierarchy = { facilities: scopeRes.facilities };

  authBtn.disabled = false;
  orgSection.style.display = "none";
  mainUI.style.display = "block";
  saveBtn.disabled = false;
  setStatus(`Authenticated — editing ${org} billing config`, "success", 3000);

  populateSelect(facilitySelect, state.scopeHierarchy.facilities);
  applyScopePrefs();
  await trackEvent("auth_success", { org });
}

async function resetToDefault() {
  if (!window.confirm("Reset local draft from server defaults and saved org file? Unsaved changes will be lost.")) return;
  setStatus("Reloading...");
  try {
    const loadRes = await api("load_billing_config", { org: state.org, token: state.token });
    if (!loadRes.success) throw new Error(loadRes.error);
    state.orgDraft = BillingAdmin.initOrgDraftFromConfig(loadRes.config);
    renderTable();
    setStatus("Reset to server config", "success", 4000);
  } catch (err) {
    setStatus(err.message || "Reset failed", "danger");
  }
}

function wireEntityTabs() {
  document.querySelectorAll("#entityTabs .nav-link").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#entityTabs .nav-link").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeEntity = tab.dataset.entity;
      saveScopePrefs();
      renderTable();
    });
  });
}

function init() {
  orgInput = document.getElementById("org");
  authBtn = document.getElementById("authBtn");
  orgSection = document.getElementById("orgSection");
  mainUI = document.getElementById("mainUI");
  statusEl = document.getElementById("status");
  facilitySelect = document.getElementById("facilitySelect");
  buSelect = document.getElementById("buSelect");
  clientSelect = document.getElementById("clientSelect");
  saveBtn = document.getElementById("saveBtn");
  tableHost = document.getElementById("tableHost");
  searchInput = document.getElementById("searchInput");
  addRecordBtn = document.getElementById("addRecordBtn");
  editModalEl = document.getElementById("editModal");
  editModalBody = document.getElementById("editModalBody");
  editModalTitle = document.getElementById("editModalTitle");
  editModalSave = document.getElementById("editModalSave");
  state.editModal = new bootstrap.Modal(editModalEl);

  authBtn.addEventListener("click", () => authenticate().catch(() => {}));
  orgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") authenticate().catch(() => {});
  });

  facilitySelect.addEventListener("change", () => {
    refreshBusinessUnits();
    saveScopePrefs();
    renderTable();
  });
  buSelect.addEventListener("change", () => {
    refreshClients();
  });
  clientSelect.addEventListener("change", () => {
    saveScopePrefs();
    renderTable();
  });

  searchInput.addEventListener("input", () => {
    state.searchQuery = searchInput.value.trim();
    renderTable();
  });

  addRecordBtn.addEventListener("click", () => openEditModal(null));
  editModalSave.addEventListener("click", saveEditModal);

  document.getElementById("exportBtn").onclick = () => {
    BillingAdmin.exportOrgConfig({ org: state.org, orgDraft: state.orgDraft, setStatus });
  };

  document.getElementById("importFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await BillingAdmin.importOrgConfigFromFile({
      file,
      org: state.org,
      orgDraft: state.orgDraft,
      setStatus,
      onApplied: () => {
        const scopeRes = { facilities: buildHierarchyFromDraft(state.orgDraft) };
        state.scopeHierarchy = scopeRes;
        populateSelect(facilitySelect, scopeRes.facilities);
        applyScopePrefs();
      },
    });
  };

  document.getElementById("resetBtn").onclick = () => resetToDefault().catch(() => {});
  saveBtn.onclick = () =>
    BillingAdmin.adminSaveDeploy({
      org: state.org,
      token: state.token,
      orgDraft: state.orgDraft,
      api,
      setStatus,
      saveBtn,
    });

  wireEntityTabs();

  const params = getUrlParams();
  const orgParam = params.get("Organization") || params.get("organization");
  if (orgParam) {
    orgInput.value = orgParam.trim();
    authenticate().catch(() => {});
  }

  api("app_opened", {}).catch(() => {});
  trackEvent("app_opened", {});
}

function buildHierarchyFromDraft(orgDraft) {
  return (orgDraft.facilities || []).map((fac) => ({
    id: fac.id,
    name: fac.name || fac.id,
    businessUnits: (fac.businessUnits || []).map((bu) => ({
      id: bu.id,
      name: bu.name || bu.id,
      clients: (bu.clients || []).map((c) => ({ id: c.id, name: c.name || c.id })),
    })),
  }));
}

// Expose search helper on BillingUI for renderTable count
BillingUI.recordMatchesSearch = function (record, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return Object.values(record).some((v) => {
    if (v == null) return false;
    if (Array.isArray(v)) return v.join(" ").toLowerCase().includes(q);
    if (typeof v === "object") return JSON.stringify(v).toLowerCase().includes(q);
    return String(v).toLowerCase().includes(q);
  });
};

document.addEventListener("DOMContentLoaded", init);

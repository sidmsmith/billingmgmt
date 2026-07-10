/** Billingmgmt — config draft helpers, export/import, save & deploy */

const ENTITY_KEYS = [
  "clientActivities",
  "rateCards",
  "rulesTransaction",
  "rulesStorage",
  "billToCodes",
  "billingLogDefinitions",
];

const UI_PREFS_KEY = "billingmgmt-ui-prefs";

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadUiPrefs() {
  try {
    return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveUiPrefs(prefs) {
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
}

function initOrgDraftFromConfig(config) {
  return deepClone({
    version: config?.version || "1.0.0",
    facilities: config?.facilities || [],
  });
}

function findClientNode(orgDraft, facilityId, buId, clientId) {
  for (const fac of orgDraft.facilities || []) {
    if (fac.id !== facilityId) continue;
    for (const bu of fac.businessUnits || []) {
      if (bu.id !== buId) continue;
      for (const client of bu.clients || []) {
        if (client.id === clientId) return client;
      }
    }
  }
  return null;
}

function getEntityRecords(orgDraft, scope, entityKey) {
  const client = findClientNode(orgDraft, scope.facilityId, scope.businessUnitId, scope.clientId);
  if (!client) return [];
  if (!client[entityKey]) client[entityKey] = [];
  return client[entityKey];
}

function upsertEntityRecord(orgDraft, scope, entityKey, record) {
  const client = findClientNode(orgDraft, scope.facilityId, scope.businessUnitId, scope.clientId);
  if (!client) return false;
  if (!client[entityKey]) client[entityKey] = [];
  const list = client[entityKey];
  const idx = list.findIndex((r) => r.id === record.id);
  if (idx >= 0) list[idx] = record;
  else list.push(record);
  return true;
}

function deleteEntityRecord(orgDraft, scope, entityKey, recordId) {
  const client = findClientNode(orgDraft, scope.facilityId, scope.businessUnitId, scope.clientId);
  if (!client || !client[entityKey]) return false;
  const before = client[entityKey].length;
  client[entityKey] = client[entityKey].filter((r) => r.id !== recordId);
  return client[entityKey].length < before;
}

function buildOrgSavePayload(org, orgDraft) {
  return {
    org: String(org || "").trim().toUpperCase(),
    updatedAt: new Date().toISOString(),
    version: orgDraft.version || "1.0.0",
    facilities: deepClone(orgDraft.facilities || []),
  };
}

function formatBillingExportFilename(org) {
  const safe = String(org || "ORG").trim().toUpperCase() || "ORG";
  const stamp = new Date().toISOString().slice(0, 10);
  return `billing-config-${safe}-${stamp}.json`;
}

function exportOrgConfig({ org, orgDraft, setStatus }) {
  const payload = buildOrgSavePayload(org, orgDraft);
  const json = JSON.stringify(payload, null, 2) + "\n";
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = formatBillingExportFilename(org);
  link.click();
  URL.revokeObjectURL(url);
  const facCount = (payload.facilities || []).length;
  setStatus(`Exported ${payload.org} (${facCount} facilit${facCount === 1 ? "y" : "ies"}) — Save & Deploy not required`, "success", 5000);
}

function normalizeImportedConfig(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid config file");
  }
  if (!Array.isArray(raw.facilities)) {
    throw new Error("Config must include a facilities array");
  }
  return {
    version: raw.version || "1.0.0",
    facilities: raw.facilities,
  };
}

async function importOrgConfigFromFile({ file, org, orgDraft, setStatus, onApplied }) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    setStatus("Import failed — invalid JSON file", "danger");
    return { success: false };
  }

  let imported;
  try {
    imported = normalizeImportedConfig(raw);
  } catch (err) {
    setStatus(err.message || "Import failed", "danger");
    return { success: false };
  }

  const targetOrg = String(org || "").trim().toUpperCase();
  const fileOrg = raw.org ? String(raw.org).trim().toUpperCase() : "";
  let message = `Import ${imported.facilities.length} facilit${imported.facilities.length === 1 ? "y" : "ies"} into ${targetOrg}?`;
  message += "\n\nThis updates your local draft only — use Save & Deploy to publish.";
  if (fileOrg && fileOrg !== targetOrg) {
    message = `This file is labeled for ${fileOrg} but you are editing ${targetOrg}.\n\n${message}`;
  }
  if (!window.confirm(message)) {
    return { success: false, cancelled: true };
  }

  orgDraft.version = imported.version;
  orgDraft.facilities = deepClone(imported.facilities);
  onApplied();
  setStatus(`Imported config — Save & Deploy when ready`, "success", 4000);
  return { success: true };
}

async function adminSaveDeploy({ org, token, orgDraft, api, setStatus, saveBtn }) {
  if (!org || !token) {
    setStatus("Authenticate before saving", "danger");
    return { success: false };
  }

  const payload = buildOrgSavePayload(org, orgDraft);
  saveBtn.disabled = true;
  setStatus("Saving to GitHub...");
  try {
    const res = await api("save_billing_config", { org, token, config: payload });
    if (!res.success) {
      setStatus(res.error || "Save failed", "danger");
      return res;
    }
    setStatus(res.message || `Saved ${org} billing config`, "success", 60000);
    return res;
  } catch (err) {
    setStatus(err.message || "Save failed", "danger");
    return { success: false, error: err.message };
  } finally {
    saveBtn.disabled = false;
  }
}

window.BillingAdmin = {
  ENTITY_KEYS,
  UI_PREFS_KEY,
  deepClone,
  loadUiPrefs,
  saveUiPrefs,
  initOrgDraftFromConfig,
  findClientNode,
  getEntityRecords,
  upsertEntityRecord,
  deleteEntityRecord,
  buildOrgSavePayload,
  exportOrgConfig,
  importOrgConfigFromFile,
  adminSaveDeploy,
};

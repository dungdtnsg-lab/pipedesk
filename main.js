(() => {
  "use strict";

  const STORAGE_KEY = "pipedesk_records_v1";
  const PASSWORD_HASH_KEY = "pipedesk_protection_hash_v1";
  const SYNC_CONFIG_KEY = "pipedesk_google_sync_v1";
  const SYNC_DELETIONS_KEY = "pipedesk_sync_deletions_v1";
  const SYNC_LAST_SUCCESS_KEY = "pipedesk_sync_last_success_v1";
  const SCHEMA_VERSION = 5;
  const DEFAULT_STAFF_NAME = "Thân Trọng Sang";
  const DEFAULT_UNIT = "HH - D7 1";
  const DEFAULT_STAFF_ROLE = "RO";
  const CENTRAL_CITIES = new Set(["Hà Nội", "Hải Phòng", "Huế", "Đà Nẵng", "Hồ Chí Minh", "Cần Thơ"]);
  const COMMON_APPLICATION_FLOWS = [
    "1. Jarvis X",
    "2. Rlos/Jarvis Thường",
    "3. NEO"
  ];

  const catalogs = {
    UPL: {
      statuses: [
        "1. B4-Thu thập hồ sơ",
        "2. Đã Login - chờ duyệt",
        "3. Đã duyệt chờ GN",
        "4. Giải ngân",
        "5. Cancel/Rej"
      ],
      products: [
        "A",
        "B",
        "C",
        "Mini HHB",
        "Tax plus",
        "HO",
        "Casa",
        "Ecomm",
        "Vehicle",
        "PCB",
        "Top-up",
        "Upper",
        "UPL Newsecured",
        "Xsell",
        "Franchise"
      ],
      flows: COMMON_APPLICATION_FLOWS,
      hasAmount: true
    },
    CC: {
      statuses: [
        "1. Thu thập hồ sơ",
        "2. Đã Login - chờ duyệt",
        "3. Đã phát hành chờ Active",
        "4. Đã Active",
        "5. Cancel/Rej"
      ],
      products: [
        "Casa",
        "Topup",
        "Ecomm",
        "Upper",
        "PCB",
        "Vehicle",
        "HO",
        "Insurance",
        "Travel",
        "Thẻ đổi thẻ",
        "Bundle Thế chấp",
        "Corporate"
      ],
      flows: COMMON_APPLICATION_FLOWS,
      hasAmount: false
    },
    SCL: {
      statuses: [
        "1. Định giá",
        "2. Thu thập hồ sơ",
        "3. Đã Login - chờ duyệt",
        "4. Đã phê duyệt",
        "5. Ký thế chấp",
        "6. Giải ngân",
        "7. Cancel/Rej"
      ],
      products: ["Tái tài trợ", "HKD1", "HKD2", "HKD3 - CBNV", "HKD3 - SXKD Thông minh", "HKD3 - SXKD Nông nghiệp", "HKD3 - Du lịch & DV khác", "HKD3 - SXKD Upper HHB", "HKD3 - Thường"],
      flows: [],
      hasAmount: true
    },
    B3: {
      statuses: [
        "Đã liên hệ - chưa phản hồi",
        "Đã liên hệ - đang trao đổi",
        "Đã liên hệ - Từ chối",
        "Đã liên hệ - Hẹn gặp",
        "Chuyển đổi Bước 4",
        "Khác"
      ],
      products: ["UPL", "SCL", "CC"],
      flows: [],
      hasAmount: false
    }
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  migrateLegacyStorage();
  let records = loadRecords();
  let deletions = loadDeletions();
  let syncTimer = null;
  let syncInProgress = false;
  let provinces = [];
  let wards = [];
  let pendingAddress = null;
  let activeSuggestionIndex = -1;
  let toastTimer;

  function migrateLegacyStorage() {
    const pairs = [
      ["vpbank_crm_records_v1", STORAGE_KEY],
      ["vpbank_crm_protection_hash_v1", PASSWORD_HASH_KEY],
      ["vpbank_crm_google_sync_v1", SYNC_CONFIG_KEY],
      ["vpbank_crm_sync_deletions_v1", SYNC_DELETIONS_KEY],
      ["vpbank_crm_sync_last_success_v1", SYNC_LAST_SUCCESS_KEY]
    ];
    for (const [from, to] of pairs) {
      if (localStorage.getItem(to)) continue;
      const value = localStorage.getItem(from);
      if (value !== null) localStorage.setItem(to, value);
    }
  }

  function identifierText(value, expectedLength) {
    if (value === null || value === undefined) return "";
    let text = String(value).trim().replace(/^'+/, "");
    if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf("."));
    if (/^\d+$/.test(text) && expectedLength && text.length === expectedLength - 1) {
      text = `0${text}`;
    }
    return text;
  }

  function normalizeRecord(record = {}) {
    const address = {
      streetAddress: String(record.streetAddress || "").trim(),
      legacyDistrict: String(record.legacyDistrict || "").trim(),
      wardName: String(record.wardName || "").trim(),
      provinceName: String(record.provinceName || "").trim()
    };
    return {
      ...record,
      id: record.id ? String(record.id) : makeId(),
      phone: identifierText(record.phone, 10),
      cccd: identifierText(record.cccd, 12),
      personalEmail: String(record.personalEmail || "").trim(),
      provinceId: record.provinceId ? String(record.provinceId) : "",
      provinceName: address.provinceName,
      wardId: record.wardId ? String(record.wardId) : "",
      wardName: address.wardName,
      legacyDistrict: address.legacyDistrict,
      streetAddress: address.streetAddress,
      fullAddress: String(record.fullAddress || "").trim() || formatFullAddress(address),
      companyName: String(record.companyName || "").trim(),
      companyAddress: String(record.companyAddress || "").trim(),
      companyRevenue: Number(record.companyRevenue) > 0 ? Number(record.companyRevenue) : null,
      insuranceType: ["BHSK", "BHKV"].includes(record.insuranceType) ? record.insuranceType : "",
      insuranceAmount: Number(record.insuranceAmount) > 0 ? Number(record.insuranceAmount) : null
    };
  }

  function loadRecords() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map(normalizeRecord) : [];
    } catch {
      return [];
    }
  }

  function loadDeletions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SYNC_DELETIONS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveRecords(options = {}) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    localStorage.setItem(SYNC_DELETIONS_KEY, JSON.stringify(deletions));
    if (options.scheduleSync !== false) scheduleSync();
  }

  function loadSyncConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || "{}");
      return {
        endpoint: String(parsed.endpoint || "").trim(),
        token: String(parsed.token || "")
      };
    } catch {
      return { endpoint: "", token: "" };
    }
  }

  function isSyncConfigured() {
    const config = loadSyncConfig();
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(config.endpoint) &&
      config.token.length >= 8;
  }

  function setSyncStatus(state, message) {
    const badge = $("#syncStatusBadge");
    const status = $("#syncStatusText");
    if (!badge || !status) return;
    const labels = {
      offline: "Chưa bật",
      pending: "Chờ mạng",
      syncing: "Đang đồng bộ",
      online: "Đã kết nối",
      error: "Có lỗi"
    };
    badge.className = `sync-badge ${state}`;
    badge.textContent = labels[state] || labels.offline;
    status.textContent = message;
    if ($("#storageNote")) {
      $("#storageNote").textContent = isSyncConfigured()
        ? "Dữ liệu được lưu trên máy và đồng bộ với Google Sheet khi có mạng."
        : "Ứng dụng hoạt động offline. Có thể kết nối Google Sheet để đồng bộ nhiều thiết bị.";
    }
  }

  function updateSyncUi() {
    const config = loadSyncConfig();
    $("#syncEndpoint").value = config.endpoint;
    $("#syncToken").value = config.token;
    $("#syncNowBtn").disabled = !isSyncConfigured() || syncInProgress;
    $("#disconnectSyncBtn").hidden = !isSyncConfigured();
    if (!isSyncConfigured()) {
      setSyncStatus("offline", "Chưa kết nối");
      return;
    }
    if (!navigator.onLine) {
      setSyncStatus("pending", "Thiết bị đang offline; thay đổi sẽ gửi khi có mạng");
      return;
    }
    const lastSuccess = localStorage.getItem(SYNC_LAST_SUCCESS_KEY);
    setSyncStatus(
      "online",
      lastSuccess
        ? `Lần cuối: ${new Date(lastSuccess).toLocaleString("vi-VN")}`
        : "Đã lưu kết nối; chưa đồng bộ lần đầu"
    );
  }

  function scheduleSync(delay = 1400) {
    if (!isSyncConfigured()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow({ silent: true }), delay);
  }

  function timestampValue(value) {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function newestById(items) {
    const map = new Map();
    for (const item of items || []) {
      if (!item?.id) continue;
      const current = map.get(item.id);
      if (!current || timestampValue(item.updatedAt || item.deletedAt) >= timestampValue(current.updatedAt || current.deletedAt)) {
        map.set(item.id, item);
      }
    }
    return map;
  }

  function mergeRemoteState(remoteRecords, remoteDeletions) {
    const active = newestById([
      ...records,
      ...(Array.isArray(remoteRecords) ? remoteRecords.map(normalizeRecord) : [])
    ]);
    const deleted = newestById([...deletions, ...(Array.isArray(remoteDeletions) ? remoteDeletions : [])]);

    for (const [id, tombstone] of deleted) {
      const record = active.get(id);
      if (!record || timestampValue(tombstone.deletedAt || tombstone.updatedAt) >= timestampValue(record.updatedAt)) {
        active.delete(id);
      } else {
        deleted.delete(id);
      }
    }

    records = [...active.values()].sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
    deletions = [...deleted.values()];
    saveRecords({ scheduleSync: false });
  }

  async function syncRequest(payload) {
    const config = loadSyncConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ ...payload, token: config.token }),
        signal: controller.signal,
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!result?.ok) throw new Error(result?.error || "Không nhận được phản hồi hợp lệ");
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function syncNow(options = {}) {
    if (syncInProgress || !isSyncConfigured()) return false;
    if (!navigator.onLine) {
      setSyncStatus("pending", "Thiết bị đang offline; thay đổi sẽ gửi khi có mạng");
      if (!options.silent) showToast("Đang offline — dữ liệu đã được giữ trên máy");
      return false;
    }

    syncInProgress = true;
    $("#syncNowBtn").disabled = true;
    setSyncStatus("syncing", "Đang đối chiếu dữ liệu với Google Sheet…");
    try {
      const result = await syncRequest({
        action: "sync",
        schemaVersion: SCHEMA_VERSION,
        records,
        deletions
      });
      mergeRemoteState(result.records, result.deletions);
      const completedAt = result.syncedAt || new Date().toISOString();
      localStorage.setItem(SYNC_LAST_SUCCESS_KEY, completedAt);
      setupSavedAddressSuggestions();
      setupStatusFilter();
      renderDashboard();
      renderCustomers();
      renderStep3();
      setSyncStatus("online", `Lần cuối: ${new Date(completedAt).toLocaleString("vi-VN")}`);
      if (!options.silent) showToast(`Đã đồng bộ ${records.length} hồ sơ`);
      return true;
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "Kết nối quá thời gian"
        : String(error?.message || "Không thể kết nối");
      setSyncStatus("error", `${message}. Dữ liệu vẫn an toàn trên máy.`);
      if (!options.silent) alert(`Không đồng bộ được Google Sheet.\n\n${message}`);
      return false;
    } finally {
      syncInProgress = false;
      $("#syncNowBtn").disabled = !isSyncConfigured();
    }
  }

  async function saveSyncConfig() {
    const endpoint = $("#syncEndpoint").value.trim();
    const token = $("#syncToken").value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(endpoint)) {
      alert("Link Apps Script chưa đúng. Link phải bắt đầu bằng https://script.google.com/macros/s/ và kết thúc bằng /exec.");
      return;
    }
    if (token.length < 8) {
      alert("Mã đồng bộ phải có ít nhất 8 ký tự.");
      return;
    }
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify({ endpoint, token }));
    updateSyncUi();
    showToast("Đã lưu kết nối Google Sheet");
    await syncNow();
  }

  function disconnectSync() {
    if (!isSyncConfigured()) return;
    if (!confirm("Ngắt kết nối Google Sheet trên thiết bị này? Dữ liệu trên máy và trên Sheet không bị xóa.")) return;
    localStorage.removeItem(SYNC_CONFIG_KEY);
    localStorage.removeItem(SYNC_LAST_SUCCESS_KEY);
    clearTimeout(syncTimer);
    updateSyncUi();
    showToast("Đã ngắt kết nối Google Sheet");
  }

  function makeId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `crm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function todayIso() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("vi-VN");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function parseAmount(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits ? Number(digits) : null;
  }

  function formatAmountInput(value) {
    const amount = parseAmount(value);
    return amount === null ? "" : formatNumber(amount);
  }

  function currentMonthValue(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 7);
  }

  function currentWeekValue(date = new Date()) {
    const local = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = local.getUTCDay() || 7;
    local.setUTCDate(local.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(local.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((local - yearStart) / 86400000) + 1) / 7);
    return `${local.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  function weekRange(value) {
    const match = /^(\d{4})-W(\d{2})$/.exec(value || "");
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const januaryFourth = new Date(Date.UTC(year, 0, 4));
    const januaryFourthDay = januaryFourth.getUTCDay() || 7;
    const monday = new Date(januaryFourth);
    monday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1 + ((week - 1) * 7));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
      start: monday.toISOString().slice(0, 10),
      end: sunday.toISOString().slice(0, 10)
    };
  }

  function monthRange(value) {
    if (!/^\d{4}-\d{2}$/.test(value || "")) return null;
    const [year, month] = value.split("-").map(Number);
    const end = new Date(Date.UTC(year, month, 0));
    return {
      start: `${value}-01`,
      end: end.toISOString().slice(0, 10)
    };
  }

  function dashboardPeriod() {
    const mode = $("#overviewPeriodType").value;
    if (mode === "week") {
      const value = $("#overviewWeek").value || currentWeekValue();
      const range = weekRange(value);
      return range ? {
        mode,
        ...range,
        label: `Tuần ${value.slice(-2)} · ${formatDate(range.start)}–${formatDate(range.end)}`
      } : { mode: "all", label: "Tất cả thời gian" };
    }
    if (mode === "month") {
      const value = $("#overviewMonth").value || currentMonthValue();
      const range = monthRange(value);
      return range ? {
        mode,
        ...range,
        label: `Tháng ${value.slice(5, 7)}/${value.slice(0, 4)}`
      } : { mode: "all", label: "Tất cả thời gian" };
    }
    return { mode: "all", label: "Tất cả thời gian" };
  }

  function dashboardRecords() {
    const period = dashboardPeriod();
    if (period.mode === "all") return records;
    return records.filter((record) => {
      const date = String(record.updatedDate || "").slice(0, 10);
      return date && date >= period.start && date <= period.end;
    });
  }

  function updateOverviewPeriodControls() {
    const mode = $("#overviewPeriodType").value;
    $("#overviewWeek").hidden = mode !== "week";
    $("#overviewMonth").hidden = mode !== "month";
    if (mode === "week" && !$("#overviewWeek").value) $("#overviewWeek").value = currentWeekValue();
    if (mode === "month" && !$("#overviewMonth").value) $("#overviewMonth").value = currentMonthValue();
  }

  function selectCurrentOverviewPeriod() {
    let mode = $("#overviewPeriodType").value;
    if (mode === "all") {
      mode = "month";
      $("#overviewPeriodType").value = mode;
    }
    if (mode === "week") $("#overviewWeek").value = currentWeekValue();
    if (mode === "month") $("#overviewMonth").value = currentMonthValue();
    updateOverviewPeriodControls();
    renderDashboard();
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replaceAll("đ", "d")
      .replaceAll("Đ", "D")
      .toLocaleLowerCase("vi")
      .trim();
  }

  function provinceBaseName(name) {
    return String(name || "").replace(/^Tp\s+/i, "");
  }

  function provinceLabel(province) {
    const baseName = provinceBaseName(province?.name);
    return CENTRAL_CITIES.has(baseName) ? `Thành phố ${baseName}` : `Tỉnh ${baseName}`;
  }

  async function loadAdministrativeCatalogs() {
    try {
      const embedded = globalThis.ADDRESS_CATALOGS;
      if (Array.isArray(embedded?.provinces) && Array.isArray(embedded?.wards)) {
        provinces = embedded.provinces;
        wards = embedded.wards;
      } else {
        const [provinceResponse, wardResponse] = await Promise.all([
          fetch("data/vietnam-provinces-2025.json"),
          fetch("data/vietnam-wards-2025.json")
        ]);
        if (!provinceResponse.ok || !wardResponse.ok) throw new Error("catalog");
        [provinces, wards] = await Promise.all([provinceResponse.json(), wardResponse.json()]);
      }
      if (!provinces.length || !wards.length) throw new Error("catalog");
      populateProvinceSelect(pendingAddress?.provinceId || "", pendingAddress?.provinceName || "");
      populateWardSelect(
        $("#province").value,
        pendingAddress?.wardId || "",
        pendingAddress?.wardName || ""
      );
      $("#provinceSearch").value = selectedText("#province");
      $("#wardSearch").value = selectedText("#ward");
      updateAddressPreview();
    } catch {
      $("#province").innerHTML = `<option value="">Không tải được danh mục</option>`;
      $("#province").disabled = true;
      $("#ward").innerHTML = `<option value="">Không tải được danh mục</option>`;
      $("#ward").disabled = true;
      $("#wardSearch").disabled = true;
    }
  }

  function populateProvinceSelect(selectedId = "", selectedName = "") {
    const select = $("#province");
    const query = normalizeSearch($("#provinceSearch")?.value);
    const filtered = query
      ? provinces.filter((province) => normalizeSearch(provinceLabel(province)).includes(query))
      : provinces;
    select.innerHTML = `<option value="">${filtered.length ? "Chọn Tỉnh / Thành phố" : "Không tìm thấy Tỉnh / Thành phố"}</option>` +
      filtered.map((province) => `<option value="${escapeHtml(province.id)}">${escapeHtml(provinceLabel(province))}</option>`).join("");
    const fallback = provinces.find((province) =>
      normalizeSearch(province.name) === normalizeSearch(selectedName) ||
      normalizeSearch(provinceLabel(province)) === normalizeSearch(selectedName)
    );
    const preferredId = selectedId || fallback?.id || "";
    if (filtered.some((province) => province.id === preferredId)) select.value = preferredId;
    else if (query && filtered.length === 1) select.value = filtered[0].id;
    else select.value = "";
    select.disabled = !provinces.length;
    $("#provinceSearch").disabled = !provinces.length;
  }

  function populateWardSelect(provinceId, selectedId = "", selectedName = "") {
    const select = $("#ward");
    const search = $("#wardSearch");
    if (!provinceId) {
      select.innerHTML = `<option value="">Chọn Tỉnh / Thành phố trước</option>`;
      select.disabled = true;
      search.value = "";
      search.disabled = true;
      return;
    }
    const query = normalizeSearch(search.value);
    const allOptions = wards
      .filter((ward) => ward.provinceId === provinceId)
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
    const options = query
      ? allOptions.filter((ward) => normalizeSearch(ward.name).includes(query))
      : allOptions;
    select.innerHTML = `<option value="">${options.length ? "Chọn Phường / Xã / Đặc khu" : "Không tìm thấy Phường / Xã / Đặc khu"}</option>` +
      options.map((ward) => `<option value="${escapeHtml(ward.id)}">${escapeHtml(ward.name)}</option>`).join("");
    const fallback = allOptions.find((ward) => normalizeSearch(ward.name) === normalizeSearch(selectedName));
    const preferredId = selectedId || fallback?.id || "";
    if (options.some((ward) => ward.id === preferredId)) select.value = preferredId;
    else if (query && options.length === 1) select.value = options[0].id;
    else select.value = "";
    select.disabled = !allOptions.length;
    search.disabled = !allOptions.length;
  }

  function selectedText(selector) {
    const select = $(selector);
    return select.value ? select.options[select.selectedIndex]?.text || "" : "";
  }

  function addressPartsFromForm() {
    return {
      streetAddress: $("#streetAddress").value.trim(),
      legacyDistrict: $("#legacyDistrict").value.trim(),
      wardName: selectedText("#ward") || pendingAddress?.wardName || "",
      provinceName: selectedText("#province") || pendingAddress?.provinceName || ""
    };
  }

  function formatFullAddress(address) {
    return [
      address.streetAddress,
      address.wardName,
      address.legacyDistrict,
      address.provinceName
    ].filter(Boolean).join(", ");
  }

  function updateAddressPreview() {
    const fullAddress = formatFullAddress(addressPartsFromForm());
    $("#addressPreview").textContent = fullAddress || "Chưa nhập địa chỉ";
    $("#addressPreview").classList.toggle("has-value", Boolean(fullAddress));
  }

  function setAddressForm(record = {}) {
    pendingAddress = {
      provinceId: record.provinceId || "",
      provinceName: record.provinceName || "",
      wardId: record.wardId || "",
      wardName: record.wardName || "",
      fullAddress: record.fullAddress || ""
    };
    $("#legacyDistrict").value = record.legacyDistrict || "";
    $("#streetAddress").value = record.streetAddress || "";
    $("#provinceSearch").value = "";
    $("#wardSearch").value = "";
    if (provinces.length) {
      populateProvinceSelect(pendingAddress.provinceId, pendingAddress.provinceName);
      populateWardSelect($("#province").value, pendingAddress.wardId, pendingAddress.wardName);
      $("#provinceSearch").value = selectedText("#province");
      $("#wardSearch").value = selectedText("#ward");
    }
    updateAddressPreview();
  }

  function setupSavedAddressSuggestions() {
    const districts = [...new Set(records.map((record) => record.legacyDistrict).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "vi"));
    const streets = [...new Set(records.map((record) => record.streetAddress).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "vi"));
    $("#legacyDistrictSuggestions").innerHTML = districts
      .map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
    $("#streetSuggestions").innerHTML = streets
      .map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  }

  function normalizeAmountInput(event) {
    const input = event?.target || $("#amount");
    const formatted = formatAmountInput(input.value);
    if (input.value === formatted) return;
    input.value = formatted;
    input.setSelectionRange?.(formatted.length, formatted.length);
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function customerSuggestionRecords(query) {
    const normalizedQuery = normalizeSearch(query);
    if (!normalizedQuery) return [];
    const newestByName = new Map();
    [...records]
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .forEach((record) => {
        const key = normalizeSearch(record.customerName);
        if (key && !newestByName.has(key)) newestByName.set(key, record);
      });
    return [...newestByName.values()]
      .filter((record) => normalizeSearch(record.customerName).includes(normalizedQuery))
      .sort((a, b) => {
        const aStarts = normalizeSearch(a.customerName).startsWith(normalizedQuery) ? 0 : 1;
        const bStarts = normalizeSearch(b.customerName).startsWith(normalizedQuery) ? 0 : 1;
        return aStarts - bStarts || a.customerName.localeCompare(b.customerName, "vi");
      })
      .slice(0, 7);
  }

  function hideCustomerSuggestions() {
    const box = $("#customerSuggestions");
    box.hidden = true;
    box.innerHTML = "";
    activeSuggestionIndex = -1;
    $("#customerName").setAttribute("aria-expanded", "false");
  }

  function renderCustomerSuggestions() {
    const suggestions = customerSuggestionRecords($("#customerName").value);
    const box = $("#customerSuggestions");
    activeSuggestionIndex = -1;
    if (!suggestions.length) {
      hideCustomerSuggestions();
      return;
    }
    box.innerHTML = suggestions.map((record, index) => `
      <button class="suggestion-item" type="button" role="option" data-suggestion-id="${escapeHtml(record.id)}" data-suggestion-index="${index}">
        <strong>${escapeHtml(record.customerName)}</strong>
        <span>${escapeHtml(record.phone || record.cccd || record.fullAddress || "Hồ sơ đã lưu")}</span>
      </button>
    `).join("");
    box.hidden = false;
    $("#customerName").setAttribute("aria-expanded", "true");
  }

  function highlightCustomerSuggestion(index) {
    const items = $$("#customerSuggestions .suggestion-item");
    if (!items.length) return;
    activeSuggestionIndex = (index + items.length) % items.length;
    items.forEach((item, itemIndex) => item.classList.toggle("active", itemIndex === activeSuggestionIndex));
    items[activeSuggestionIndex].scrollIntoView({ block: "nearest" });
  }

  function applyCustomerSuggestion(record) {
    if (!record) return;
    $("#customerName").value = record.customerName || "";
    $("#phone").value = record.phone || "";
    $("#cccd").value = record.cccd || "";
    $("#personalEmail").value = record.personalEmail || "";
    $("#companyName").value = record.companyName || "";
    $("#companyAddress").value = record.companyAddress || "";
    $("#companyRevenue").value = formatAmountInput(record.companyRevenue);
    updatePhoneActions();
    setAddressForm(record);
    hideCustomerSuggestions();
    showToast("Đã điền thông tin khách hàng đã lưu");
  }

  function handleCustomerNameKeydown(event) {
    const items = $$("#customerSuggestions .suggestion-item");
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlightCustomerSuggestion(activeSuggestionIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlightCustomerSuggestion(activeSuggestionIndex - 1);
    } else if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault();
      items[activeSuggestionIndex].click();
    } else if (event.key === "Escape") {
      hideCustomerSuggestions();
    }
  }

  function setView(viewId) {
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
    if (viewId === "dashboardView") renderDashboard();
    if (viewId === "customersView") renderCustomers();
    if (viewId === "step3View") renderStep3();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const pipelineColumns = [
    ["updatedDate", "Ngày cập nhật"],
    ["unit", "Đơn vị"],
    ["staffName", "Họ tên CBB"],
    ["staffRole", "Chức danh"],
    ["customerName", "Tên khách hàng"],
    ["phone", "Số điện thoại"],
    ["personalEmail", "Email cá nhân"],
    ["cccd", "CCCD"],
    ["status", "Tình trạng hồ sơ"],
    ["statusDate", "Ngày đổi trạng thái"],
    ["flow", "Luồng trình"],
    ["product", "Sản phẩm"],
    ["amount", "Số tiền (triệu)"],
    ["companyName", "Tên công ty"],
    ["companyAddress", "Địa chỉ công ty"],
    ["companyRevenue", "Doanh thu (triệu)"],
    ["insuranceType", "Bảo hiểm"],
    ["insuranceAmount", "Số tiền BH (triệu)"],
    ["fullAddress", "Địa chỉ"],
    ["notes", "Ghi chú"]
  ];

  function phoneHref(phone) {
    return String(phone || "").replace(/[^\d+]/g, "");
  }

  function zaloHref(phone) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.startsWith("0")) digits = `84${digits.slice(1)}`;
    return digits ? `https://zalo.me/${digits}` : "";
  }

  function updatePhoneActions() {
    const link = $("#phoneZaloLink");
    if (!link) return;
    const href = zaloHref($("#phone").value);
    link.href = href || "#";
    link.classList.toggle("disabled", !href);
    link.setAttribute("aria-disabled", href ? "false" : "true");
  }

  function isCancelStatus(status) {
    return /cancel|rej/.test(normalizeSearch(status));
  }

  function isDisbursedStatus(status) {
    return normalizeSearch(status).includes("giai ngan");
  }

  function isActiveCcStatus(status) {
    return normalizeSearch(status).includes("da active");
  }

  function mapHref(address) {
    return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "";
  }

  function tableCell(record, key) {
    if (key === "updatedDate" || key === "statusDate") return escapeHtml(formatDate(record[key]));
    if (key === "amount" || key === "companyRevenue" || key === "insuranceAmount") {
      return Number(record[key]) > 0 ? escapeHtml(formatNumber(record[key])) : "—";
    }
    if (key === "phone") {
      const phone = phoneHref(record.phone);
      const zalo = zaloHref(record.phone);
      return phone
        ? `<span class="phone-links"><a class="table-link" href="tel:${escapeHtml(phone)}">${escapeHtml(record.phone)}</a>${zalo ? ` · <a class="table-link zalo-link" href="${escapeHtml(zalo)}" target="_blank" rel="noopener">Zalo</a>` : ""}</span>`
        : "—";
    }
    if (key === "personalEmail") {
      const email = String(record.personalEmail || "").trim();
      return email
        ? `<a class="table-link" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
        : "—";
    }
    if (key === "fullAddress") {
      const address = record.fullAddress || "";
      return address
        ? `<a class="table-link" href="${escapeHtml(mapHref(address))}" target="_blank" rel="noopener">${escapeHtml(address)}</a>`
        : "—";
    }
    return escapeHtml(record[key] || "—");
  }

  function renderPipelineTable(container, type, options = {}) {
    if (!container) return;
    const sourceRecords = Array.isArray(options.records) ? options.records : records;
    const list = sourceRecords
      .filter((record) => record.type === type)
      .filter((record) => !options.search || [
        record.customerName,
        record.phone,
        record.personalEmail,
        record.cccd,
        record.product,
        record.status,
        record.fullAddress,
        record.companyName,
        record.companyAddress,
        record.insuranceType
      ].some((value) => normalizeSearch(value).includes(options.search)))
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    if (!list.length) {
      container.innerHTML = `<div class="table-empty">${options.emptyText || "Chưa có dữ liệu."}</div>`;
      return;
    }

    const columns = type === "B3"
      ? pipelineColumns.filter(([key]) => key !== "amount" && key !== "flow")
      : pipelineColumns;
    container.innerHTML = `
      <div class="table-scroll">
        <table class="data-table ${type === "B3" ? "compact-table" : ""}">
          <thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}${options.actions ? "<th>Thao tác</th>" : ""}</tr></thead>
          <tbody>
            ${list.map((record) => `
              <tr>
                ${columns.map(([key]) => `<td class="${key === "fullAddress" || key === "notes" || key === "companyAddress" ? "wrap" : ""}">${tableCell(record, key)}</td>`).join("")}
                ${options.actions ? `<td><button class="edit-btn" data-edit="${escapeHtml(record.id)}">Mở hồ sơ</button></td>` : ""}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function renderStep3() {
    const search = normalizeSearch($("#step3SearchInput").value);
    const count = records.filter((record) => record.type === "B3" && (!search || [
      record.customerName,
      record.phone,
      record.personalEmail,
      record.cccd,
      record.product,
      record.status,
      record.fullAddress,
      record.companyName,
      record.companyAddress
    ].some((value) => normalizeSearch(value).includes(search)))).length;
    $("#step3Count").textContent = `${count} khách hàng cần chăm sóc`;
    renderPipelineTable($("#step3Table"), "B3", {
      search,
      actions: true,
      emptyText: records.some((record) => record.type === "B3")
        ? "Không tìm thấy khách hàng Bước 3 phù hợp."
        : "Chưa có khách hàng Bước 3."
    });
  }

  function renderDashboard() {
    const overviewRecords = dashboardRecords();
    const period = dashboardPeriod();
    const byType = { UPL: 0, CC: 0, SCL: 0, B3: 0 };
    const amounts = { UPL: 0, SCL: 0 };
    const statusMap = new Map();
    let disbursedAmount = 0;
    let activeCcCount = 0;

    for (const record of overviewRecords) {
      if (byType[record.type] !== undefined) byType[record.type] += 1;
      if (record.type === "UPL" || record.type === "SCL") amounts[record.type] += Number(record.amount) || 0;
      if ((record.type === "UPL" || record.type === "SCL") && isDisbursedStatus(record.status)) {
        disbursedAmount += Number(record.amount) || 0;
      }
      if (record.type === "CC" && isActiveCcStatus(record.status)) activeCcCount += 1;
      const status = record.status || "Chưa cập nhật";
      statusMap.set(status, (statusMap.get(status) || 0) + 1);
    }

    $("#todayText").textContent = period.label;
    $("#totalCustomers").textContent = overviewRecords.length;
    $("#uplCount").textContent = byType.UPL;
    $("#ccCount").textContent = byType.CC;
    $("#sclCount").textContent = byType.SCL;
    $("#b3Count").textContent = byType.B3;
    $("#uplAmount").textContent = `${formatNumber(amounts.UPL)} triệu`;
    $("#sclAmount").textContent = `${formatNumber(amounts.SCL)} triệu`;
    $("#disbursedAmount").textContent = `${formatNumber(disbursedAmount)} triệu`;
    $("#activeCcCount").textContent = `${formatNumber(activeCcCount)} thẻ`;
    renderPipelineTable($("#uplOverviewTable"), "UPL", {
      records: overviewRecords,
      emptyText: period.mode === "all" ? "Chưa có hồ sơ UPL." : "Không có hồ sơ UPL trong kỳ."
    });
    renderPipelineTable($("#ccOverviewTable"), "CC", {
      records: overviewRecords,
      emptyText: period.mode === "all" ? "Chưa có hồ sơ Thẻ CC." : "Không có hồ sơ Thẻ CC trong kỳ."
    });

    const statusBox = $("#statusBreakdown");
    if (!overviewRecords.length) {
      statusBox.className = "status-breakdown empty-state compact-empty";
      statusBox.textContent = period.mode === "all"
        ? "Chưa có dữ liệu để thống kê."
        : "Không có dữ liệu trong khoảng thời gian đã chọn.";
      return;
    }

    const sorted = [...statusMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    const max = Math.max(...sorted.map((entry) => entry[1]), 1);
    statusBox.className = "status-breakdown";
    statusBox.innerHTML = sorted.map(([label, count]) => `
      <div class="status-row ${isCancelStatus(label) ? "is-cancel" : ""}">
        <div>
          <div class="status-label"><span>${escapeHtml(label)}</span><span>${Math.round(count / overviewRecords.length * 100)}%</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${count / max * 100}%"></div></div>
        </div>
        <div class="status-count">${count}</div>
      </div>
    `).join("");
  }

  function allStatuses() {
    return [...new Set(Object.values(catalogs).flatMap((catalog) => catalog.statuses))];
  }

  function setupStatusFilter() {
    const selected = $("#statusFilter").value;
    $("#statusFilter").innerHTML = `<option value="">Tất cả trạng thái</option>` +
      allStatuses().map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join("");
    $("#statusFilter").value = selected;
  }

  function filteredRecords() {
    const search = normalizeSearch($("#searchInput").value);
    const type = $("#typeFilter").value;
    const status = $("#statusFilter").value;
    return records
      .filter((record) => !type || record.type === type)
      .filter((record) => !status || record.status === status)
      .filter((record) => {
        if (!search) return true;
        return [
          record.customerName,
          record.phone,
          record.personalEmail,
          record.cccd,
          record.staffName,
          record.product,
          record.notes,
          record.unit,
          record.fullAddress,
          record.provinceName,
          record.wardName,
          record.legacyDistrict,
          record.streetAddress,
          record.companyName,
          record.companyAddress
        ].some((value) => normalizeSearch(value).includes(search));
      })
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function renderCustomers() {
    const list = filteredRecords();
    $("#resultCount").textContent = `${list.length} hồ sơ`;
    const container = $("#customerList");
    if (!list.length) {
      container.innerHTML = `
        <div class="empty-state">
          <strong>${records.length ? "Không tìm thấy hồ sơ phù hợp" : "Chưa có khách hàng"}</strong>
          <span>${records.length ? "Thử đổi bộ lọc hoặc từ khóa tìm kiếm." : "Bấm “Thêm mới” để tạo hồ sơ đầu tiên."}</span>
        </div>`;
      return;
    }

    container.innerHTML = list.map((record) => {
      const amount = Number(record.amount) > 0 ? `${formatNumber(record.amount)} triệu` : "—";
      const callablePhone = phoneHref(record.phone);
      const zaloLink = zaloHref(record.phone);
      const addressLink = mapHref(record.fullAddress);
      return `
        <article class="customer-card" data-id="${escapeHtml(record.id)}">
          <div class="customer-top">
            <div>
              <h3>${escapeHtml(record.customerName)}</h3>
              <div class="customer-meta">
                <span class="badge type">${escapeHtml(record.type === "B3" ? "KH Bước 3" : record.type)}</span>
                <span class="badge ${isCancelStatus(record.status) ? "cancel" : ""}">${escapeHtml(record.status || "Chưa cập nhật")}</span>
              </div>
            </div>
          </div>
          <div class="record-details">
            <div class="detail"><span>Sản phẩm</span><strong>${escapeHtml(record.product || "—")}</strong></div>
            <div class="detail"><span>Số tiền</span><strong>${escapeHtml(amount)}</strong></div>
            <div class="detail"><span>Bảo hiểm</span><strong>${escapeHtml(record.insuranceType ? `${record.insuranceType}${Number(record.insuranceAmount) > 0 ? ` · ${formatNumber(record.insuranceAmount)} triệu` : ""}` : "—")}</strong></div>
            <div class="detail"><span>Cán bộ bán</span><strong>${escapeHtml(record.staffName || "—")}</strong></div>
            <div class="detail"><span>Cập nhật</span><strong>${escapeHtml(formatDate(record.updatedDate))}</strong></div>
            <div class="detail"><span>Điện thoại</span><strong>${escapeHtml(record.phone || "—")}</strong></div>
            <div class="detail"><span>Email cá nhân</span><strong>${escapeHtml(record.personalEmail || "—")}</strong></div>
            <div class="detail"><span>CCCD</span><strong>${escapeHtml(record.cccd || "—")}</strong></div>
            <div class="detail address-detail"><span>Địa chỉ</span><strong>${escapeHtml(record.fullAddress || "—")}</strong></div>
            <div class="detail"><span>Công ty</span><strong>${escapeHtml(record.companyName || "—")}</strong></div>
            <div class="detail"><span>Doanh thu</span><strong>${escapeHtml(Number(record.companyRevenue) > 0 ? `${formatNumber(record.companyRevenue)} triệu` : "—")}</strong></div>
            <div class="detail address-detail"><span>Địa chỉ công ty</span><strong>${escapeHtml(record.companyAddress || "—")}</strong></div>
          </div>
          <div class="card-actions">
            ${callablePhone ? `<a class="call-btn" href="tel:${escapeHtml(callablePhone)}">Gọi</a>` : ""}
            ${zaloLink ? `<a class="zalo-btn" href="${escapeHtml(zaloLink)}" target="_blank" rel="noopener">Zalo</a>` : ""}
            ${record.personalEmail ? `<a class="email-btn" href="mailto:${escapeHtml(record.personalEmail)}">Email</a>` : ""}
            ${addressLink ? `<a class="map-btn" href="${escapeHtml(addressLink)}" target="_blank" rel="noopener">Maps</a>` : ""}
            <button class="edit-btn" data-edit="${escapeHtml(record.id)}">Sửa</button>
            <button class="delete-btn" data-delete="${escapeHtml(record.id)}">Xóa</button>
          </div>
        </article>`;
    }).join("");
  }

  function fillSelect(select, values, placeholder) {
    const current = select.value;
    select.innerHTML = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "";
    select.innerHTML += values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    if (values.includes(current)) select.value = current;
  }

  function updateFormCatalog(preserve = true) {
    const type = $("#recordType").value;
    const catalog = catalogs[type];
    const statusValue = preserve ? $("#recordStatus").value : "";
    const productValue = preserve ? $("#product").value : "";
    const flowValue = preserve ? $("#flow").value : "";
    fillSelect($("#recordStatus"), catalog.statuses, "Chọn trạng thái");
    fillSelect($("#product"), catalog.products, "Chọn sản phẩm");
    fillSelect($("#flow"), catalog.flows, catalog.flows.length ? "Chọn luồng trình" : "Không áp dụng");
    if (catalog.statuses.includes(statusValue)) $("#recordStatus").value = statusValue;
    if (catalog.products.includes(productValue)) $("#product").value = productValue;
    if (catalog.flows.includes(flowValue)) $("#flow").value = flowValue;
    $("#flow").disabled = !catalog.flows.length;
    $("#amountField").style.display = catalog.hasAmount ? "grid" : "none";
    if (!catalog.hasAmount) $("#amount").value = "";
  }

  function openForm(record = null) {
    $("#customerForm").reset();
    hideCustomerSuggestions();
    $("#recordId").value = record?.id || "";
    $("#formTitle").textContent = record ? "Sửa khách hàng" : "Thêm khách hàng";
    $("#recordType").value = record?.type || "UPL";
    updateFormCatalog(false);

    $("#updatedDate").value = record?.updatedDate || todayIso();
    $("#customerName").value = record?.customerName || "";
    $("#phone").value = record?.phone || "";
    $("#cccd").value = record?.cccd || "";
    $("#personalEmail").value = record?.personalEmail || "";
    updatePhoneActions();
    setAddressForm(record || {});
    $("#unit").value = record ? (record.unit || "") : DEFAULT_UNIT;
    $("#staffName").value = record ? (record.staffName || "") : DEFAULT_STAFF_NAME;
    $("#staffRole").value = record ? (record.staffRole || DEFAULT_STAFF_ROLE) : DEFAULT_STAFF_ROLE;
    $("#statusDate").value = record?.statusDate || "";
    $("#amount").value = formatAmountInput(record?.amount);
    $("#companyName").value = record?.companyName || "";
    $("#companyAddress").value = record?.companyAddress || "";
    $("#companyRevenue").value = formatAmountInput(record?.companyRevenue);
    $("#insuranceType").value = record?.insuranceType || "";
    $("#insuranceAmount").value = formatAmountInput(record?.insuranceAmount);
    $("#notes").value = record?.notes || "";
    if (record) {
      if (record.status && !catalogs[record.type].statuses.includes(record.status)) {
        $("#recordStatus").insertAdjacentHTML("beforeend", `<option value="${escapeHtml(record.status)}">${escapeHtml(record.status)}</option>`);
      }
      if (record.product && !catalogs[record.type].products.includes(record.product)) {
        $("#product").insertAdjacentHTML("beforeend", `<option value="${escapeHtml(record.product)}">${escapeHtml(record.product)}</option>`);
      }
      if (record.flow && !catalogs[record.type].flows.includes(record.flow)) {
        $("#flow").disabled = false;
        $("#flow").insertAdjacentHTML("beforeend", `<option value="${escapeHtml(record.flow)}">${escapeHtml(record.flow)}</option>`);
      }
      $("#recordStatus").value = record.status || "";
      $("#product").value = record.product || "";
      $("#flow").value = record.flow || "";
    }

    $("#formModal").classList.add("open");
    $("#formModal").setAttribute("aria-hidden", "false");
    setTimeout(() => $("#customerName").focus(), 120);
  }

  function closeForm() {
    hideCustomerSuggestions();
    $("#formModal").classList.remove("open");
    $("#formModal").setAttribute("aria-hidden", "true");
  }

  function readForm() {
    const existing = records.find((record) => record.id === $("#recordId").value);
    const address = addressPartsFromForm();
    const fullAddress = formatFullAddress(address) || pendingAddress?.fullAddress || existing?.fullAddress || "";
    return {
      id: existing?.id || makeId(),
      type: $("#recordType").value,
      updatedDate: $("#updatedDate").value,
      customerName: $("#customerName").value.trim(),
      phone: identifierText($("#phone").value, 10),
      cccd: identifierText($("#cccd").value, 12),
      personalEmail: $("#personalEmail").value.trim(),
      provinceId: $("#province").value || pendingAddress?.provinceId || "",
      provinceName: address.provinceName,
      wardId: $("#ward").value || pendingAddress?.wardId || "",
      wardName: address.wardName,
      legacyDistrict: address.legacyDistrict,
      streetAddress: address.streetAddress,
      fullAddress,
      unit: $("#unit").value.trim(),
      staffName: $("#staffName").value.trim(),
      staffRole: $("#staffRole").value,
      status: $("#recordStatus").value,
      statusDate: $("#statusDate").value,
      flow: $("#flow").value,
      product: $("#product").value,
      amount: $("#amountField").style.display === "none" ? null : parseAmount($("#amount").value),
      companyName: $("#companyName").value.trim(),
      companyAddress: $("#companyAddress").value.trim(),
      companyRevenue: parseAmount($("#companyRevenue").value),
      insuranceType: $("#insuranceType").value,
      insuranceAmount: parseAmount($("#insuranceAmount").value),
      notes: $("#notes").value.trim(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function identifierDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function duplicateWarnings(record) {
    const phone = identifierDigits(record.phone);
    const cccd = identifierDigits(record.cccd);
    return records
      .filter((item) => item.id !== record.id)
      .map((item) => {
        const reasons = [];
        if (phone && identifierDigits(item.phone) === phone) reasons.push("SĐT");
        if (cccd && identifierDigits(item.cccd) === cccd) reasons.push("CCCD");
        return reasons.length ? { item, reasons } : null;
      })
      .filter(Boolean);
  }

  async function submitForm(event) {
    event.preventDefault();
    const saveButton = $("#saveCustomerBtn");
    saveButton.disabled = true;
    const record = readForm();
    const duplicates = duplicateWarnings(record);
    if (duplicates.length) {
      const details = duplicates
        .slice(0, 5)
        .map(({ item, reasons }) => `• ${item.customerName || "Khách hàng chưa có tên"} — trùng ${reasons.join(" và ")}`)
        .join("\n");
      const more = duplicates.length > 5 ? `\n• Và ${duplicates.length - 5} hồ sơ khác` : "";
      if (!confirm(`Phát hiện thông tin đã có trong danh sách:\n\n${details}${more}\n\nBấm OK để vẫn tiếp tục lưu, hoặc Hủy để kiểm tra lại.`)) {
        saveButton.disabled = false;
        return;
      }
    }
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) records[index] = record;
    else records.push(record);
    deletions = deletions.filter((item) => item.id !== record.id);
    saveRecords({ scheduleSync: false });
    setupSavedAddressSuggestions();
    closeForm();
    setupStatusFilter();
    renderDashboard();
    renderCustomers();
    renderStep3();
    const action = index >= 0 ? "Đã cập nhật khách hàng" : "Đã thêm khách hàng";
    if (!isSyncConfigured()) {
      showToast(`${action} trên máy`);
      saveButton.disabled = false;
      return;
    }
    if (syncInProgress) {
      scheduleSync(250);
      showToast(`${action}; đang chờ sao lưu cloud`);
      saveButton.disabled = false;
      return;
    }
    showToast(`${action}; đang sao lưu cloud…`);
    const synced = await syncNow({ silent: true });
    showToast(synced ? `${action} và đã sao lưu cloud` : `${action} trên máy; cloud sẽ thử lại`);
    if (!synced) scheduleSync(1800);
    saveButton.disabled = false;
  }

  function deleteRecord(id) {
    const record = records.find((item) => item.id === id);
    if (!record) return;
    if (!confirm(`Xóa hồ sơ của “${record.customerName}”?`)) return;
    const deletedAt = new Date().toISOString();
    deletions = deletions.filter((item) => item.id !== id);
    deletions.push({ id, type: record.type, deletedAt, updatedAt: deletedAt });
    records = records.filter((item) => item.id !== id);
    saveRecords();
    setupSavedAddressSuggestions();
    renderDashboard();
    renderCustomers();
    renderStep3();
    showToast("Đã xóa khách hàng");
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function exportJson() {
    const payload = {
      app: "PipeDesk",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records
    };
    downloadFile(`pipedesk-backup-${todayIso()}.json`, JSON.stringify(payload, null, 2), "application/json");
    showToast("Đã tạo bản sao lưu JSON");
  }

  function xmlEscape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function columnName(index) {
    let value = index + 1;
    let name = "";
    while (value > 0) {
      value -= 1;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  }

  function sheetXml(rows, headerStyle) {
    const maxColumns = Math.max(...rows.map((row) => row.length), 1);
    const cols = Array.from({ length: maxColumns }, (_, index) => {
      const width = index === 4 || index === 7 || index === 12 || index === 13 ? 28 : 18;
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    }).join("");
    const sheetRows = rows.map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => {
        const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
        const style = rowIndex === 0 ? ` s="${headerStyle}"` : "";
        if (typeof value === "number" && Number.isFinite(value)) {
          return `<c r="${reference}"${style} t="n"><v>${value}</v></c>`;
        }
        return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
        <cols>${cols}</cols>
        <sheetData>${sheetRows}</sheetData>
        <autoFilter ref="A1:${columnName(maxColumns - 1)}${Math.max(rows.length, 1)}"/>
      </worksheet>`;
  }

  function excelRowsForType(type) {
    const columns = type === "B3"
      ? pipelineColumns.filter(([key]) => key !== "amount" && key !== "flow")
      : pipelineColumns;
    const body = records
      .filter((record) => record.type === type)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .map((record) => columns.map(([key]) => {
        if (key === "updatedDate" || key === "statusDate") return formatDate(record[key]);
        if (key === "amount" || key === "companyRevenue" || key === "insuranceAmount") return Number(record[key]) || 0;
        return record[key] || "";
      }));
    return [columns.map(([, label]) => label), ...body];
  }

  function uint16(value) {
    return new Uint8Array([value & 255, (value >>> 8) & 255]);
  }

  function uint32(value) {
    return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
  }

  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    return value >>> 0;
  });

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipFiles(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;

    for (const [filename, content] of Object.entries(files)) {
      const name = encoder.encode(filename);
      const data = typeof content === "string" ? encoder.encode(content) : content;
      const crc = crc32(data);
      const localHeader = concatBytes([
        uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
        uint32(crc), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), name
      ]);
      localParts.push(localHeader, data);

      const centralHeader = concatBytes([
        uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
        uint32(crc), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), uint16(0),
        uint16(0), uint16(0), uint32(0), uint32(localOffset), name
      ]);
      centralParts.push(centralHeader);
      localOffset += localHeader.length + data.length;
    }

    const localData = concatBytes(localParts);
    const centralData = concatBytes(centralParts);
    const endRecord = concatBytes([
      uint32(0x06054b50), uint16(0), uint16(0), uint16(centralParts.length), uint16(centralParts.length),
      uint32(centralData.length), uint32(localData.length), uint16(0)
    ]);
    return concatBytes([localData, centralData, endRecord]);
  }

  function buildExcelWorkbook() {
    const amounts = {
      UPL: records.filter((record) => record.type === "UPL").reduce((sum, record) => sum + (Number(record.amount) || 0), 0),
      SCL: records.filter((record) => record.type === "SCL").reduce((sum, record) => sum + (Number(record.amount) || 0), 0)
    };
    const overviewRows = [
      ["Chỉ tiêu", "Số lượng hồ sơ", "Tổng số tiền (triệu đồng)"],
      ["Tổng khách hàng", records.length, amounts.UPL + amounts.SCL],
      ["UPL", records.filter((record) => record.type === "UPL").length, amounts.UPL],
      ["Thẻ CC", records.filter((record) => record.type === "CC").length, 0],
      ["SCL", records.filter((record) => record.type === "SCL").length, amounts.SCL],
      ["Khách hàng Bước 3", records.filter((record) => record.type === "B3").length, 0]
    ];
    const sheets = [
      { name: "Overview", rows: overviewRows, style: 3 },
      { name: "UPL", rows: excelRowsForType("UPL"), style: 1 },
      { name: "The CC", rows: excelRowsForType("CC"), style: 2 },
      { name: "SCL", rows: excelRowsForType("SCL"), style: 3 },
      { name: "KH Buoc 3", rows: excelRowsForType("B3"), style: 4 }
    ];
    const worksheetOverrides = sheets.map((_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join("");
    const workbookSheets = sheets.map((sheet, index) =>
      `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    ).join("");
    const workbookRels = sheets.map((_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    ).join("");
    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
          <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
          ${worksheetOverrides}
        </Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
        </Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets>${workbookSheets}</sheets>
        </workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          ${workbookRels}
          <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
        </Relationships>`,
      "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts>
          <fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF008B57"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF8F1537"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF062B4F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF9A6713"/><bgColor indexed="64"/></patternFill></fill></fills>
          <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFDCE5E3"/></left><right style="thin"><color rgb="FFDCE5E3"/></right><top style="thin"><color rgb="FFDCE5E3"/></top><bottom style="thin"><color rgb="FFDCE5E3"/></bottom><diagonal/></border></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="5">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
            <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
            <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
            <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
            <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
          </cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
        </styleSheet>`
    };
    sheets.forEach((sheet, index) => {
      files[`xl/worksheets/sheet${index + 1}.xml`] = sheetXml(sheet.rows, sheet.style);
    });
    return zipFiles(files);
  }

  async function hashPassword(password) {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(password);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return Array.from(String(password)).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 2166136261).toString(16);
  }

  async function configurePassword(requireCurrent = true) {
    const currentHash = localStorage.getItem(PASSWORD_HASH_KEY);
    if (currentHash && requireCurrent) {
      const current = prompt("Nhập mật khẩu hiện tại:");
      if (current === null) return false;
      if (await hashPassword(current) !== currentHash) {
        alert("Mật khẩu hiện tại không đúng.");
        return false;
      }
    }
    const password = prompt("Tạo mật khẩu bảo vệ (tối thiểu 4 ký tự):");
    if (password === null) return false;
    if (password.length < 4) {
      alert("Mật khẩu phải có ít nhất 4 ký tự.");
      return false;
    }
    const confirmation = prompt("Nhập lại mật khẩu mới:");
    if (confirmation !== password) {
      alert("Hai lần nhập mật khẩu không khớp.");
      return false;
    }
    localStorage.setItem(PASSWORD_HASH_KEY, await hashPassword(password));
    showToast("Đã lưu mật khẩu bảo vệ");
    return true;
  }

  async function authorizeProtectedAction(actionLabel) {
    const currentHash = localStorage.getItem(PASSWORD_HASH_KEY);
    if (!currentHash) {
      alert(`Chưa có mật khẩu bảo vệ. Hãy tạo mật khẩu trước khi ${actionLabel}.`);
      return configurePassword(false);
    }
    const password = prompt(`Nhập mật khẩu để ${actionLabel}:`);
    if (password === null) return false;
    if (await hashPassword(password) !== currentHash) {
      alert("Mật khẩu không đúng.");
      return false;
    }
    return true;
  }

  async function exportExcel() {
    if (!await authorizeProtectedAction("xuất file Excel")) return;
    const workbook = buildExcelWorkbook();
    downloadFile(
      `pipedesk-${todayIso()}.xlsx`,
      workbook,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    showToast("Đã tạo file Excel");
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const fileText = typeof file.text === "function"
        ? await file.text()
        : await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error || new Error("read"));
          reader.readAsText(file, "utf-8");
        });
      const payload = JSON.parse(fileText);
      const incoming = Array.isArray(payload) ? payload : payload.records;
      if (!Array.isArray(incoming)) throw new Error("invalid");
      if (!confirm(`Nhập ${incoming.length} hồ sơ và thay thế dữ liệu hiện tại?`)) return;
      const importedIds = new Set(incoming.map((record) => record.id).filter(Boolean));
      const deletedAt = new Date().toISOString();
      for (const record of records) {
        if (!importedIds.has(record.id)) {
          deletions = deletions.filter((item) => item.id !== record.id);
          deletions.push({ id: record.id, type: record.type, deletedAt, updatedAt: deletedAt });
        }
      }
      records = incoming.map(normalizeRecord);
      saveRecords({ scheduleSync: false });
      setupSavedAddressSuggestions();
      setupStatusFilter();
      renderDashboard();
      renderCustomers();
      renderStep3();
      showToast(`Đã nhập ${records.length} hồ sơ; đang sao lưu cloud…`);
      if (isSyncConfigured()) {
        const synced = await syncNow({ silent: true });
        showToast(synced
          ? `Đã nhập và sao lưu cloud ${records.length} hồ sơ`
          : `Đã nhập ${records.length} hồ sơ trên máy; cloud sẽ thử lại`);
        if (!synced) scheduleSync(1800);
      } else {
        showToast(`Đã nhập ${records.length} hồ sơ`);
      }
    } catch {
      alert("File sao lưu không hợp lệ.");
    }
  }

  async function clearAll() {
    if (!records.length) {
      showToast("Danh sách đang trống");
      return;
    }
    if (!await authorizeProtectedAction("xóa toàn bộ khách hàng")) return;
    if (!confirm("Xóa toàn bộ khách hàng trên thiết bị? Thao tác này không thể hoàn tác.")) return;
    const deletedAt = new Date().toISOString();
    const ids = new Set(records.map((record) => record.id));
    deletions = deletions.filter((item) => !ids.has(item.id));
    deletions.push(...records.map((record) => ({
      id: record.id,
      type: record.type,
      deletedAt,
      updatedAt: deletedAt
    })));
    records = [];
    saveRecords();
    setupSavedAddressSuggestions();
    setupStatusFilter();
    renderDashboard();
    renderCustomers();
    renderStep3();
    showToast("Đã xóa toàn bộ dữ liệu");
  }

  function bindEvents() {
    $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    $("#addTopBtn").addEventListener("click", () => openForm());
    $("#addCustomerBtn").addEventListener("click", () => openForm());
    $("#addStep3Btn").addEventListener("click", () => {
      openForm();
      $("#recordType").value = "B3";
      updateFormCatalog(false);
    });
    $("#goCustomersBtn").addEventListener("click", () => setView("customersView"));
    $$("[data-dashboard-type]").forEach((button) => button.addEventListener("click", () => {
      $("#typeFilter").value = button.dataset.dashboardType;
      $("#statusFilter").value = "";
      setView("customersView");
    }));
    $$("[data-close-modal]").forEach((button) => button.addEventListener("click", closeForm));
    $("#recordType").addEventListener("change", () => updateFormCatalog(false));
    $("#amount").addEventListener("input", normalizeAmountInput);
    $("#amount").addEventListener("blur", normalizeAmountInput);
    $("#companyRevenue").addEventListener("input", normalizeAmountInput);
    $("#companyRevenue").addEventListener("blur", normalizeAmountInput);
    $("#insuranceAmount").addEventListener("input", normalizeAmountInput);
    $("#insuranceAmount").addEventListener("blur", normalizeAmountInput);
    $("#phone").addEventListener("input", updatePhoneActions);
    $("#overviewPeriodType").addEventListener("change", () => {
      updateOverviewPeriodControls();
      renderDashboard();
    });
    $("#overviewWeek").addEventListener("change", renderDashboard);
    $("#overviewMonth").addEventListener("change", renderDashboard);
    $("#currentPeriodBtn").addEventListener("click", selectCurrentOverviewPeriod);
    $("#customerName").addEventListener("input", renderCustomerSuggestions);
    $("#customerName").addEventListener("focus", renderCustomerSuggestions);
    $("#customerName").addEventListener("keydown", handleCustomerNameKeydown);
    $("#customerSuggestions").addEventListener("mousedown", (event) => event.preventDefault());
    $("#customerSuggestions").addEventListener("click", (event) => {
      const item = event.target.closest("[data-suggestion-id]");
      if (item) applyCustomerSuggestion(records.find((record) => record.id === item.dataset.suggestionId));
    });
    $("#provinceSearch").addEventListener("input", () => {
      const previousId = $("#province").value;
      populateProvinceSelect(previousId);
      if ($("#province").value !== previousId || ($("#province").value && !$("#ward").value)) {
        $("#wardSearch").value = "";
        populateWardSelect($("#province").value);
      }
      updateAddressPreview();
    });
    $("#province").addEventListener("change", () => {
      pendingAddress = null;
      $("#provinceSearch").value = selectedText("#province");
      $("#wardSearch").value = "";
      populateWardSelect($("#province").value);
      updateAddressPreview();
    });
    $("#wardSearch").addEventListener("input", () => {
      const previousId = $("#ward").value;
      populateWardSelect($("#province").value, previousId);
      updateAddressPreview();
    });
    $("#ward").addEventListener("change", () => {
      $("#wardSearch").value = selectedText("#ward");
      updateAddressPreview();
    });
    $("#legacyDistrict").addEventListener("input", updateAddressPreview);
    $("#streetAddress").addEventListener("input", updateAddressPreview);
    $("#customerForm").addEventListener("submit", submitForm);
    $("#searchInput").addEventListener("input", renderCustomers);
    $("#step3SearchInput").addEventListener("input", renderStep3);
    $("#typeFilter").addEventListener("change", renderCustomers);
    $("#statusFilter").addEventListener("change", renderCustomers);
    $("#customerList").addEventListener("click", (event) => {
      const editId = event.target.dataset.edit;
      const deleteId = event.target.dataset.delete;
      if (editId) openForm(records.find((record) => record.id === editId));
      if (deleteId) deleteRecord(deleteId);
    });
    $("#step3Table").addEventListener("click", (event) => {
      const editId = event.target.dataset.edit;
      if (editId) openForm(records.find((record) => record.id === editId));
    });
    $("#exportJsonBtn").addEventListener("click", exportJson);
    $("#exportExcelBtn").addEventListener("click", exportExcel);
    $("#passwordBtn").addEventListener("click", () => configurePassword(true));
    $("#importJsonInput").addEventListener("change", importJson);
    $("#clearAllBtn").addEventListener("click", clearAll);
    $("#saveSyncBtn").addEventListener("click", saveSyncConfig);
    $("#syncNowBtn").addEventListener("click", () => syncNow());
    $("#disconnectSyncBtn").addEventListener("click", disconnectSync);
    window.addEventListener("online", () => {
      updateSyncUi();
      scheduleSync(300);
    });
    window.addEventListener("offline", updateSyncUi);
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".autocomplete-wrap")) hideCustomerSuggestions();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && $("#formModal").classList.contains("open")) closeForm();
    });
  }

  $("#overviewWeek").value = currentWeekValue();
  $("#overviewMonth").value = currentMonthValue();
  updateOverviewPeriodControls();
  updatePhoneActions();
  setupStatusFilter();
  setupSavedAddressSuggestions();
  bindEvents();
  updateSyncUi();
  loadAdministrativeCatalogs();
  renderDashboard();
  renderCustomers();
  renderStep3();
  scheduleSync(900);
})();

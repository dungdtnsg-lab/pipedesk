(() => {
  const KEY = "pipedesk_records_v1";
  const LEGACY_KEY = "vpbank_crm_records_v1";
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const existing = JSON.parse(raw);
      if (existing && existing.enc === 1) return;
      if (Array.isArray(existing) && existing.length) return;
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    if (Array.isArray(legacy) && legacy.length) {
      localStorage.setItem(KEY, JSON.stringify(legacy));
      return;
    }
  } catch {
    /* seed demo records for first-run testing */
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const records = [
    {
      id: "demo-upl-1",
      type: "UPL",
      updatedDate: today,
      customerName: "Nguyễn Văn An",
      phone: "0901234567",
      cccd: "079012345678",
      personalEmail: "nguyenvanan@gmail.com",
      provinceId: "29",
      provinceName: "Thành phố Hồ Chí Minh",
      wardId: "70101065",
      wardName: "Phường Bến Thành",
      legacyDistrict: "Quận 1",
      streetAddress: "123 Nguyễn Huệ",
      fullAddress: "123 Nguyễn Huệ, Phường Bến Thành, Quận 1, Thành phố Hồ Chí Minh",
      unit: "HH - D7 1",
      staffName: "Thân Trọng Sang",
      staffRole: "MSO",
      status: "4. Giải ngân",
      statusDate: today,
      flow: "1. Jarvis X",
      product: "Mini HHB",
      amount: 1500,
      companyName: "TNHH TM DV An Phát",
      companyAddress: "45 Pasteur, Phường Bến Thành, TP. Hồ Chí Minh",
      companyRevenue: 2400,
      insuranceType: "BHSK",
      insuranceAmount: 18,
      notes: "DEMO — hồ sơ UPL đã giải ngân. Test Overview + Zalo + Email.",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "demo-cc-1",
      type: "CC",
      updatedDate: today,
      customerName: "Trần Thị Bình",
      phone: "0912345678",
      cccd: "079198765432",
      personalEmail: "tranthibinh@gmail.com",
      provinceId: "29",
      provinceName: "Thành phố Hồ Chí Minh",
      wardId: "70101064",
      wardName: "Phường Tân Định",
      legacyDistrict: "Quận 1",
      streetAddress: "45 Hai Bà Trưng",
      fullAddress: "45 Hai Bà Trưng, Phường Tân Định, Quận 1, Thành phố Hồ Chí Minh",
      unit: "HH - D7 1",
      staffName: "Thân Trọng Sang",
      staffRole: "RO",
      status: "4. Đã Active",
      statusDate: today,
      flow: "3. NEO",
      product: "Casa",
      amount: null,
      notes: "DEMO — thẻ CC đã Active. Bấm Zalo / mailto để kiểm tra.",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "demo-scl-1",
      type: "SCL",
      updatedDate: today,
      customerName: "Lê Văn Cường",
      phone: "0987654321",
      cccd: "083077889900",
      personalEmail: "levancuong@gmail.com",
      provinceId: "31",
      provinceName: "Tỉnh Đồng Tháp",
      wardId: "80701001",
      wardName: "Phường Mỹ Tho",
      legacyDistrict: "Thành phố Mỹ Tho",
      streetAddress: "12 Ấp Bắc",
      fullAddress: "12 Ấp Bắc, Phường Mỹ Tho, Thành phố Mỹ Tho, Tỉnh Đồng Tháp",
      unit: "HH - D7 1",
      staffName: "Thân Trọng Sang",
      staffRole: "RMB",
      status: "4. Đã phê duyệt",
      statusDate: today,
      flow: "",
      product: "HKD3 - SXKD Thông minh",
      amount: 3500,
      notes: "DEMO — SCL chờ giải ngân.",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "demo-b3-1",
      type: "B3",
      updatedDate: today,
      customerName: "Phạm Thị Dung",
      phone: "0909888777",
      cccd: "079055566677",
      personalEmail: "phamthidung@gmail.com",
      provinceId: "29",
      provinceName: "Thành phố Hồ Chí Minh",
      wardId: "70105069",
      wardName: "Phường Nhiêu Lộc",
      legacyDistrict: "Quận 3",
      streetAddress: "88 Cách Mạng Tháng 8",
      fullAddress: "88 Cách Mạng Tháng 8, Phường Nhiêu Lộc, Quận 3, Thành phố Hồ Chí Minh",
      unit: "HH - D7 1",
      staffName: "Thân Trọng Sang",
      staffRole: "MSO",
      status: "Đã liên hệ - Hẹn gặp",
      statusDate: today,
      flow: "",
      product: "UPL",
      amount: null,
      notes: "DEMO — lead Bước 3 hẹn gặp tuần này.",
      createdAt: now,
      updatedAt: now
    }
  ];

  localStorage.setItem(KEY, JSON.stringify(records));
})();

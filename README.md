# PipeDesk

PWA quản lý pipeline khách hàng (UPL, thẻ CC, SCL, Bước 3). Chạy offline trên máy, có Zalo / Email / Maps, xuất JSON–Excel và đồng bộ Google Sheet.

**Phiên bản:** 1.6.1

## Cài trên iPhone (thay cho IPA)

App Store IPA cần tài khoản Apple Developer và máy Mac để ký. PipeDesk là PWA: mở bằng Safari rồi ghim ra màn hình chính.

Bật GitHub Pages một lần: repo **Settings → Pages → Source = GitHub Actions**, rồi workflow tự deploy.

1. Mở [https://dungdtnsg-lab.github.io/pipedesk/](https://dungdtnsg-lab.github.io/pipedesk/) bằng **Safari** trên iPhone.
2. Bấm nút **Chia sẻ** → **Thêm vào Màn hình chính**.
3. Icon PipeDesk hiện như app, dùng offline.

Android/Chrome: mở cùng link → **Cài ứng dụng** / **Thêm vào màn hình chính**.

## Dùng local

Cần máy chủ HTTPS hoặc `localhost` (service worker không chạy với `file://`).

```bash
python3 -m http.server 8080
```

Mở `http://127.0.0.1:8080`.

## Tính năng

- Tổng quan theo tuần / tháng
- Hồ sơ UPL, Thẻ CC, SCL, Bước 3
- Kinh doanh: tên công ty, địa chỉ, doanh thu
- Bảo hiểm BHSK / BHKV + số tiền
- Gọi điện, Zalo, Email, Google Maps
- Địa chỉ hành chính VN 2025 (offline)
- Sao lưu JSON / Excel (Excel có mật khẩu)
- Đồng bộ Google Sheet (Apps Script)

Dữ liệu khách chỉ lưu trên thiết bị (`localStorage`), không gửi lên GitHub.

## Mặc định hồ sơ mới

- Cán bộ bán: Thân Trọng Sang
- Đơn vị: HH - D7 1
- Chức danh: RO

# PipeDesk

PWA quản lý pipeline khách hàng (UPL, thẻ CC, SCL, Bước 3).

**Phiên bản:** 1.7.2

## Tải IPA (iPhone)

File IPA unsigned, build trên GitHub Actions (macOS / Xcode):

**[Releases → PipeDesk v1.7.2 IPA](https://github.com/dungdtnsg-lab/pipedesk/releases/tag/v1.7.2-ios)**

Cài bằng **Sideloadly** (Windows/Mac) hoặc **AltStore / SideStore**:

1. Tải `PipeDesk.ipa`
2. Mở Sideloadly → kéo IPA vào → đăng nhập Apple ID miễn phí
3. Cắm iPhone USB → Start
4. iPhone: **Cài đặt → General → VPN & Device Management** → Trust

Không cài trực tiếp từ Files được — iOS bắt buộc ký bằng Apple ID. IPA này **chưa ký** (không có tài khoản Apple Developer trên máy build).

Bundle ID: `app.thansang.pipedesk`

## Source

- PWA (web): `index.html`, `main.js`, `style.css`
- iOS wrapper (WKWebView): `ios/`

## Dùng local (web)

```bash
python3 -m http.server 8080
```

Mở `http://127.0.0.1:8080`.

Dữ liệu khách chỉ lưu trên thiết bị, không gửi lên GitHub.

## CCCD Việt Nam

- Quét QR CCCD theo payload 12 số của Việt Nam.
- Chọn ảnh CCCD từ thư viện: app đọc QR trước, sau đó OCR Vision trên iPhone.
- Tự điền ngày sinh, ngày cấp CCCD và nơi cấp CCCD khi thông tin xuất hiện trên ảnh hoặc API OCR trả về.
- Có thể cấu hình server OCR theo tài liệu [Vietnamese-CitizenID-Recognition](https://github.com/thigiacmaytinh/Vietnamese-CitizenID-Recognition) bằng cách đặt URL `/api/idcard` vào khóa `CCCDOCRAPIURL` trong `ios/PipeDesk/Info.plist`. Để trống khóa này thì dùng OCR cục bộ.

PipeDesk PWA v1.6.0

Cách sử dụng bản trực tuyến:
1. Mở đường dẫn PWA bằng trình duyệt.
2. Android/Chrome: bấm "Cài ứng dụng" hoặc chọn "Thêm vào màn hình chính".
3. iPhone/Safari: bấm Chia sẻ > Thêm vào Màn hình chính.

Cách chạy bộ mã nguồn PWA:
1. Đưa toàn bộ thư mục này lên một máy chủ web có HTTPS.
2. Mở file index.html qua địa chỉ HTTPS của máy chủ.
3. Không mở trực tiếp bằng đường dẫn file:// vì service worker cần HTTPS hoặc localhost.

Dữ liệu:
- Dữ liệu khởi tạo hoàn toàn trống.
- Dữ liệu khách hàng lưu cục bộ trên từng thiết bị.
- Dùng mục Sao lưu để xuất JSON/Excel hoặc khôi phục từ JSON.
- File Excel có các sheet Overview, UPL, Thẻ CC, SCL và KH Bước 3.
- Xuất Excel và xóa toàn bộ dữ liệu được bảo vệ bằng mật khẩu do người dùng tự tạo.
- Hồ sơ mới mặc định cán bộ bán "Thân Trọng Sang" và đơn vị "HH - D7 1".
- Số tiền nhập theo đơn vị triệu đồng và tự phân tách hàng nghìn bằng dấu chấm.
- Khi gõ tên khách hàng, ứng dụng gợi ý các khách hàng đã lưu; chọn một gợi ý
  sẽ tự điền SĐT, CCCD và địa chỉ gần nhất.
- Danh mục địa chỉ offline gồm 34 tỉnh/thành và 3.321 phường/xã/đặc khu áp dụng
  từ 01/07/2025.
- SĐT và CCCD được lưu dạng chuỗi để giữ số 0 ở đầu.
- Khi lưu khách hàng, ứng dụng tự đồng bộ Google Sheet nếu đã cấu hình kết nối.
- Hồ sơ có Email cá nhân; SĐT có nút mở Zalo.
- Khi SĐT hoặc CCCD bị trùng, ứng dụng cảnh báo và cho phép chọn tiếp tục hay quay lại.

Phát triển bởi Thân Sang.

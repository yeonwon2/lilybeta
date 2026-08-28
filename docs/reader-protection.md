# Hạn chế sao chép và thanh Sửa phía dưới

Chỉ áp dụng trong màn hình đọc của Beta Reader: chặn sự kiện copy, cut, dragstart và menu chuột phải trên văn bản. Ô nhập đề xuất/ghi chú vẫn cho thao tác bình thường; không cấm bôi đen. Không thay đổi quyền Admin hoặc API.

Watermark lặp tên đăng nhập Beta trên màn hình, không chặn thao tác. Không thể chống tuyệt đối ảnh chụp màn hình, OCR hay lấy nội dung bằng công cụ trình duyệt.

Khi chọn chữ trong một đoạn, Sửa/Ghi chú nằm cố định dưới màn hình với khoảng an toàn cho điện thoại. Chọn nhiều đoạn vẫn hiện cảnh báo. Đổi chương sẽ xóa thanh chọn cũ.

Không cần SQL. API xuất file vẫn yêu cầu Admin; quyền truyện được giao giữ nguyên.

Kiểm thử tự động: `npm run test:protection`, `npm test`, `npm run build`.
Kiểm thử DOM trên bản thảo giả (không truy cập dữ liệu/tài khoản): chạy Vite rồi mở `/tests/fixtures/protection-check.html`, bấm Kiểm tra bảo vệ (PASS), Bôi đen mẫu, Sửa (kết quả `Sửa: Hắn, 0-3`), thử Ghi chú. Kiểm tra ở 390×844 và desktop. Fixture không nằm trong production build.

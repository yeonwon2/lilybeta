# Sửa nhanh và thanh Ghi chú phía dưới

Chỉ áp dụng trong màn hình đọc của Beta Reader: không chặn copy, cut, dragstart hay menu chuột phải. Beta Reader chỉ cần nhấp vào đoạn văn cần sửa để mở ngay hộp thoại đề xuất chỉnh sửa, không cần bôi đen chữ.

Watermark lặp tên đăng nhập Beta trên màn hình, không chặn thao tác. Không thay đổi quyền Admin hoặc API.

Nếu muốn ghi chú cho một đoạn chữ cụ thể, vẫn có thể bôi đen chữ trong một đoạn để thanh Ghi chú hiện cố định dưới màn hình với khoảng an toàn cho điện thoại. Đổi chương sẽ xóa thanh chọn cũ.

Không cần SQL. API xuất file vẫn yêu cầu Admin; quyền truyện được giao giữ nguyên.

Kiểm thử tự động: `npm run test:protection`, `npm test`, `npm run build`.
Kiểm thử DOM trên bản thảo giả (không truy cập dữ liệu/tài khoản): chạy Vite rồi mở `/tests/fixtures/protection-check.html`, bấm Kiểm tra không chặn copy (PASS), Bôi đen mẫu, thử Ghi chú. Kiểm tra ở 390×844 và desktop. Fixture không nằm trong production build.

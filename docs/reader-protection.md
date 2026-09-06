# Sửa trực tiếp trên văn bản

Chỉ áp dụng trong màn hình đọc của Beta Reader: không chặn copy, cut, dragstart hay menu chuột phải.

Beta Reader chỉ cần nhấp vào đoạn văn cần sửa — đoạn đó biến thành một ô nhập liệu ngay tại chỗ, gõ/xóa/sửa trực tiếp như sửa văn bản thường, rồi bấm ra ngoài (blur) để tự động lưu. Không có hộp thoại, không cần chọn loại lỗi, không cần ghi lý do, không cần bôi đen chữ. Đoạn nào không đổi thì không lưu gì cả.

Mỗi đoạn văn có tối đa một chỉnh sửa đang hoạt động (bao trùm toàn bộ đoạn văn gốc). Nếu đoạn đã có chỉnh sửa, nhấp vào sẽ mở ra đúng nội dung đang đề xuất (không phải bản gốc) để sửa tiếp; sửa lại y hệt bản gốc sẽ tự xóa chỉnh sửa đó. Có nút "Khôi phục nguyên văn" nhỏ ngay dưới đoạn để hoàn tác nhanh mà không cần gõ lại.

Admin vẫn biết chính xác đoạn nào đã bị sửa: mọi thay đổi vẫn được ghi lại như một bản beta-edit (văn bản gốc, văn bản đề xuất, người sửa, thời gian, lịch sử phiên bản) và hiển thị trong trang Duyệt Bản Thảo (`/admin/books/:bookId/review`) với đoạn được tô màu theo trạng thái duyệt. Tính năng phân loại lỗi/ghi chú lý do đã được bỏ khỏi giao diện Beta để đơn giản hóa; các bản ghi mới được lưu với loại "Khác".

Watermark lặp tên đăng nhập Beta trên màn hình, không chặn thao tác. Không thay đổi quyền Admin hoặc API.

Không cần SQL. API xuất file vẫn yêu cầu Admin; quyền truyện được giao giữ nguyên.

Kiểm thử tự động: `npm run test:protection`, `npm test`, `npm run build`.
Kiểm thử DOM trên bản thảo giả (không truy cập dữ liệu/tài khoản): chạy Vite rồi mở `/tests/fixtures/protection-check.html`, bấm Kiểm tra không chặn copy (PASS). Fixture không nằm trong production build.

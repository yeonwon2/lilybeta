# Đổi thông tin Admin

Vào Admin → **Tài khoản Admin** (cạnh nút đăng xuất).

- Muốn đổi tên đăng nhập: nhập tên mới và mật khẩu hiện tại; để trống hai ô mật khẩu mới.
- Muốn đổi mật khẩu: giữ tên đăng nhập, nhập mật khẩu hiện tại và mật khẩu mới hai lần.
- Có thể đổi cả hai cùng lúc. Mật khẩu mới tối thiểu 12 ký tự, tối đa 72 byte UTF-8.
- Bấm **Lưu thay đổi**. Phiên đang dùng được cấp token mới; các phiên cũ phải đăng nhập lại.

Localhost và online dùng database riêng: đổi ở đâu chỉ có hiệu lực ở đó.
Không cần SQL/migration mới. Không sửa ID, vai trò, truyện hay tài khoản Beta Reader.

## Triển khai / bảo mật

`PATCH /api/admin/account` chỉ cho Admin đang đăng nhập, xác nhận lại mật khẩu hiện tại.
Mật khẩu được băm bcrypt; request không được chọn ID/vai trò tài khoản đích.
UPDATE kiểm tra giá trị cũ để chống cập nhật đồng thời; sự kiện audit cùng transaction.
Token mới chứa HMAC phiên bản thông tin đăng nhập, không chứa mật khẩu/hash.
Ngay cả khi đổi tên trở lại tên cũ, salt mới ngăn token cũ có hiệu lực trở lại.

Token cũ phát hành trước tính năng vẫn dùng được đến khi đổi tài khoản. Sau đổi,
sự kiện `ADMIN_ACCOUNT_CHANGED` vô hiệu hóa token cũ không có version. Không xóa
sự kiện này khi bổ sung tính năng dọn audit trong tương lai mà chưa thay cơ chế thu hồi.
Không ghi mật khẩu, hash hoặc token vào activity logs.

Kiểm thử: `npm run test:account` chạy database SQLite và PostgreSQL giả lập riêng;
bao gồm sai mật khẩu, dữ liệu lỗi, trùng username, IDOR, token cũ, rename quay lại,
cập nhật đồng thời, và đảm bảo tài khoản Beta không bị thay đổi.

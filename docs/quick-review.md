# Duyệt nhanh (bổ sung)

Trong Phòng Biên Tập, chọn **Duyệt nhanh**, chọn một hoặc nhiều chương (hoặc tất cả chương đủ điều kiện), xác nhận và bấm **Chấp nhận & duyệt**.

- Chỉ áp dụng cho phân công Beta đang xem, chương Beta đã hoàn thành và chưa phê duyệt.
- Chấp nhận đề xuất đang chờ theo đúng phiên bản; giữ nguyên phần đã từ chối. Chương yêu cầu sửa lại hoặc xung đột cần xử lý riêng.
- Chương được xử lý tuần tự, tối đa 200 đề xuất mỗi yêu cầu. Không tải lại toàn bộ tổng quan sau mỗi đề xuất.
- Có kết quả riêng mỗi chương; thử lại chỉ chạy chương lỗi. Chương đã duyệt không bị duyệt lại.
- Nếu phê duyệt cuối cùng bị chặn, các quyết định chấp nhận đã lưu vẫn giữ nguyên; chương chưa được phê duyệt và giao diện báo rõ.
- Duyệt từng đề xuất, mở lại rà soát, upload thủ công, Editor sync và xuất file giữ nguyên.
- Không cần SQL hay migration mới.

Kiểm thử: `npm run test:bulk-review` (SQLite và PostgreSQL qua PGlite), `npm test`, `npm run build`. Dữ liệu thử nghiệm tách biệt với truyện thật.

# Sửa lỗi tải chậm và trắng trang

Bản gốc đối chiếu: `origin/main` tại commit `c4d5aad`.

## Nguyên nhân và thay đổi

- Express 4 không tự chuyển Promise bị reject từ controller/middleware đến error handler. Bọc các controller và kiểm tra quyền sách bằng `asyncHandler`, trả JSON lỗi thay vì để request treo. Lỗi database trong xác thực không còn bị gán nhầm thành 401.
- API client trước đây không có timeout, có thể giữ màn hình tải vô thời hạn. Giới hạn 20 giây cho API thông thường và 120 giây cho nhập bản thảo; timeout bao gồm cả việc đọc response body. Không tự gửi lại thao tác ghi. Khi thao tác ghi timeout, cần kiểm tra trạng thái trước khi gửi lại vì backend có thể vẫn hoàn tất.
- Phản hồi HTML do proxy/SPA rewrite hoặc JSON hỏng được báo là lỗi, không chuyển tiếp vào component như dữ liệu hợp lệ.
- Lỗi localStorage không còn làm hỏng khởi tạo ứng dụng hoặc đăng nhập; phiên tạm trong bộ nhớ được dùng khi không thể ghi storage. Phiên này không bảo đảm tồn tại sau reload.
- Đăng nhập không còn bật loading toàn ứng dụng làm unmount form và mất thông báo lỗi. Khôi phục phiên thất bại vì lỗi mạng/server có màn hình thử lại và giữ token; 401 vẫn kết thúc phiên.
- Tách trang quản trị, duyệt và đọc sách thành các chunk tải theo nhu cầu. Bundle JavaScript entry giảm từ 426.87 KB (gzip 117.28 KB) xuống khoảng 213.36 KB (gzip 67.40 KB). Đây là kích thước build, không phải phép đo thời gian tải production.
- Font bên ngoài không còn chặn lần vẽ đầu. Có nội dung chờ trong HTML và Error Boundary cho lỗi render/tải chunk, kèm nút tải lại; không xóa bản nháp.
- IndexedDB bị chặn, treo hoặc abort chuyển sang memory fallback. Không chờ ghi cache trước khi trả chương vừa tải. Cache mở và thao tác có deadline riêng 1 giây.
- Lỗi khởi động serverless trả JSON 503. Pool dùng riêng cho migration được đóng cả khi migration lỗi hoặc thoát sớm.

## Kiểm chứng

```sh
NODE_ENV=test DATABASE_PROVIDER=sqlite npm test
npm run build
git diff --check
```

Toàn bộ 8 bộ kiểm thử cũ (411 assertions) và 9 kiểm thử mới trong `tests/loading-resilience.test.ts` đạt. Kiểm thử mới gồm timeout request/body, giải phóng dedupe để retry, HTML/JSON lỗi, storage bị chặn/hết quota, backend/database reject, cache ghi chậm, mở bị chặn/treo và transaction abort.

Đã thử bản build bằng trình duyệt và SQLite riêng trong `/tmp`: đăng nhập sai hiển thị lỗi, đăng nhập đúng mở quản trị, reload khôi phục phiên; khi backend ngắt kết nối có màn hình lỗi và nút thử lại, khi backend trở lại khôi phục được phiên mà không đăng nhập lại.

## Giới hạn và triển khai

Thay đổi chưa được push hoặc deploy. Chưa xác minh bằng database PostgreSQL/Supabase production và log Vercel. Sau deploy cần kiểm tra lại đăng nhập, mở chương, upload bản thảo lớn và cold start trên domain thật. Không có thay đổi schema hay thao tác với dữ liệu production trong đợt sửa này.

## Bổ sung: lỗi khi bấm Duyệt bản thảo

Màn hình duyệt đã khai báo một kiểu response riêng không khớp backend: đọc `chapter.paragraphs`, `approvedParagraphs`, `approvedConflict`, `chapterReview.status`, trong khi API trả `chapter.originalParagraphs`, `approvedVersion.paragraphs`, `approvedVersion.conflict`, `chapter.derivedStatus`. Điều này gây lỗi `.map` trên `undefined` ngay khi chương tải xong; Error Boundary chỉ giúp hiện thông báo thay vì trắng trang.

Đã dùng chung `ChapterReviewDetailResponse` giữa server và client, sửa đường dẫn dữ liệu cho cả ba lớp nội dung, trạng thái phê duyệt và cảnh báo xung đột. Tách `ReviewChapterContent` để kiểm thử render trực tiếp bằng response thật từ API. Bổ sung 12 assertions vào bộ review (từ 47 lên 59), bao gồm bản đề xuất mới và bản đã duyệt cũ khác revision. Đồng thời không để spinner chạy mãi khi sách chưa có phân công và vô hiệu hóa phê duyệt khi chưa có dữ liệu.

Đã kiểm tra bằng trình duyệt local: bấm Duyệt từ danh sách bản thảo, chuyển Working/Approved/Nguyên tác, nội dung hiển thị và không có lỗi console. Các thao tác dùng SQLite và bản thảo thử riêng, không dùng dữ liệu production.

# Xuất file đã duyệt — quyết định cuối cùng

Thay cho cả direct publish và ZIP package: LilyBeta chỉ xuất file thông thường.
LilyHub giữ nguyên code và chức năng nhập file đã có. Không thêm API ghi chéo,
không integration secret, không migration/SQL, không thay đổi production khi kiểm thử.
Các thay đổi thử nghiệm ZIP/import ở LilyHub đã được gỡ; tài liệu audit cũ chỉ là lịch sử.

## Sử dụng

Trong Duyệt bản thảo → **Xuất file** → chọn chương → chọn TXT / Word (.docx) / PDF.
Mặc định chọn chương hiện tại nếu đã duyệt; có thể chọn nhiều hoặc tất cả đã duyệt.
Nguồn là assignment/Beta Reader đang hiển thị; không gộp các Reader.

Để đưa vào LilyHub hiện tại, chọn **TXT**, dùng mục **Nhập EPUB/TXT** trong màn soạn
nhiều chương. File có tiêu đề `Chương N: ...` để bộ đọc đang có nhận số chương.
DOCX/PDF dùng để lưu, đọc, chia sẻ; không tuyên bố importer LilyHub hỗ trợ hai định dạng này.
LilyHub vẫn giữ hành vi xử lý chương trùng/ghi đè hiện có; cần xem trước khi đăng lại.

## An toàn và hiệu năng

- Chỉ reconstruct `approved_edits_snapshot`, không dùng live edits.
- Chặn chương chưa duyệt/mở lại, phiên duyệt đổi, nguồn đổi sau duyệt, anchor lỗi/chồng lấn.
- Chỉ đọc metadata để chọn; endpoint Admin đọc đúng một chương đã chọn mỗi request.
- 305 chương thử nghiệm, chọn 101–105: đúng 5 bodies được đọc.
- Tối đa 1000 chương / 10 MB nội dung mỗi file; PDF tối đa 1 MB nội dung để tránh treo thiết bị.
- JSZip (DOCX) và pdfmake/font (PDF) chỉ tải khi xuất, không tăng tải ban đầu của trang.
- TXT UTF-8 BOM; Word OOXML không macro; PDF nhúng Roboto có dấu tiếng Việt.
- Không chỉnh sửa nội dung gốc/biên tập/duyệt khi xuất. Lỗi từng chương được báo rõ nếu xuất thiếu.

## Kiểm thử

- `npm test`: security, upload thủ công, Editor sync SQLite/Postgres giả lập,
  assignment → edit → complete → review → approve, export snapshot, 305-chapter selection.
- `npm run test:export`: TXT, Word XML, PDF, nội dung và ký tự tiếng Việt.
- `LILYHUB_REPO=/path/to/lilyhub npm run test:export`: chạy chính readDraftFile +
  parseChapterDraft hiện có của LilyHub với TXT xuất. Chỉ đọc source, không sửa repo/DB.
- Word mở/render bằng LibreOffice; PDF và Word-render kiểm tra ảnh đủ 2 trang.
- Browser: `npx vite --config tests/export-ui.config.ts`, mở
  `http://127.0.0.1:3416/tests/export-ui.html`. API giả lập cục bộ; CSP chặn mạng ngoài.
- `npm run build`. PDF có warning chunk lớn nhưng nằm trong dynamic import riêng.

Không có kiểm thử nào ghi bản thảo production. Chưa push/deploy tính năng này.

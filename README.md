# LilyBeta — Phase 5: Production Database + Supabase/Postgres Migration + Final QA Foundation

LilyBeta là hệ thống dành riêng cho Beta Reader của LilyHub (`beta.lilyhub.top`). Hệ thống được thiết kế để Ban quản trị cấp phát bản thảo, phân công quyền đọc duyệt bảo mật, và đảm bảo **tuyệt đối không bị rò rỉ dữ liệu (chống IDOR)** giữa các Beta Reader.

---

## 🎯 Mục tiêu & Tiến độ các Phase

- **Phase 1**: Backend Foundation + Auth + Phân công + Chống IDOR.
- **Phase 2**: Multi-Assignment per Book + Chapter Workflow (`NOT_STARTED` $\to$ `IN_PROGRESS` $\to$ `READY` $\to$ `COMPLETED`).
- **Phase 3 & 3.1**: Inline Edits + Multi-Revision History + Paragraph Notes + Delta Writes + Local Storage Draft Recovery.
- **Phase 4 & 4.5**: Admin Review Workspace + Revision-Bound Decisions + Approved Version Snapshot + Lean Egress + In-Flight Request Deduplication.
- **Phase 5 (Hiện tại)**: **Production Database (Supabase / PostgreSQL)** + Data Access Abstraction Layer + Optimistic Concurrency + Derived Book Readiness Foundation (`READY_TO_PUBLISH`).

---

## 🏗️ Kiến trúc Persistence & Data Access Abstraction

Hệ thống cung cấp abstraction layer chuẩn hóa (`server/db/DatabaseAdapter.ts`):

```text
React Client (Vite)
       ↓
LilyBeta API Client (Token / Authorization)
       ↓
Express Backend Route Controllers
       ↓
DatabaseAdapter Abstraction
 ├── SqliteAdapter (Local Dev / Offline Tests: WAL mode + Node DatabaseSync)
 └── PostgresAdapter (Production: Supabase / PostgreSQL via pg.Pool)
```

### Chế độ hoạt động môi trường (`DATABASE_PROVIDER`):
- `DATABASE_PROVIDER=sqlite`: Cho phép dùng trong môi trường development và automated test suite (`npm test`).
- `DATABASE_PROVIDER=postgres`: Bắt buộc khi chạy production. Nếu `NODE_ENV=production` mà thiếu `DATABASE_URL` hoặc cấu hình `sqlite`, hệ thống sẽ **Fail-Fast** và dừng ngay khi khởi động nhằm ngăn chặn việc vô tình dùng SQLite tạm thời trên server.

---

## 🚀 Cài đặt & Khởi chạy

### Yêu cầu môi trường
- Node.js: >= 20 (khuyên dùng Node.js 22/24)
- npm: >= 10

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Cấu hình môi trường
Tạo file `.env` từ `.env.example`:
```bash
cp .env.example .env
```

**Môi trường Local Development (SQLite):**
```env
PORT=3006
NODE_ENV=development
DATABASE_PROVIDER=sqlite
DB_PATH=./data/lilybeta.db
JWT_SECRET=lilybeta-super-secret-key-change-in-production
```

**Môi trường Production (Supabase / PostgreSQL):**
```env
PORT=3006
NODE_ENV=production
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://postgres.YOUR_PROJECT:YOUR_PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DB_POOL_MAX=10
JWT_SECRET=your-strong-random-jwt-secret-min-32-chars
BOOTSTRAP_ADMIN=true
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=your-secure-admin-password
CORS_ORIGIN=https://beta.lilyhub.top
```

### 3. Khởi tạo Database Migrations
```bash
npm run db:migrate
```
- Nếu `DATABASE_PROVIDER=sqlite`: Chạy các migration trong `server/migrations/versions/`.
- Nếu `DATABASE_PROVIDER=postgres`: Chạy PostgreSQL baseline schema trong `server/migrations/postgres/001_initial_schema.sql`.

### 4. Khởi chạy Development
```bash
npm run dev
```

---

## 🛡️ Connection Pooling & Supabase Strategy

- **Driver**: Sử dụng `pg` (`node-postgres`) kết hợp `pg.Pool` để tái sử dụng connection và giới hạn tải (`DB_POOL_MAX`).
- **Connection String**:
  - **Transaction Pooler (Port 6543)**: Khuyên dùng khi deploy trên các môi trường serverless hoặc container có số lượng connection biến động lớn.
  - **Direct Session (Port 5432)**: Dùng cho persistent dedicated backend servers hoặc database migrations.
- **Ambient Transaction Context**: Hệ thống sử dụng Node.js `AsyncLocalStorage` để tự động ràng buộc mọi câu lệnh SQL trong `transaction(async () => { ... })` vào cùng 1 kết nối `client` đã checkout từ pool, bảo đảm tính nguyên tử (atomic) và tự động `ROLLBACK` khi phát sinh lỗi.
- **Placeholder Translation**: PostgreSQL sử dụng `$1, $2, ...` trong khi SQLite dùng `?`. `PostgresAdapter` tự động biên dịch các dấu `?` bên ngoài chuỗi string literal thành `$1, $2, ...`, giúp toàn bộ logic controllers chạy song song trên cả 2 cơ sở dữ liệu mà không cần fork code.

---

## 📊 Derived Book Readiness Endpoint (`GET /api/admin/books/:id/readiness`)

Endpoint phục vụ kiểm tra toàn diện chất lượng sách trước khi xuất bản:
- **Tuyến đường**: `GET /api/admin/books/:id/readiness` (yêu cầu Admin token).
- **Nguyên tắc Invariant**: Không thể gán thủ công `Mark Ready` khi còn blocker. Trạng thái `READY_TO_PUBLISH` là **derived state** chỉ đạt được khi:
  1. Tất cả các chương đã được Beta Reader đánh dấu `COMPLETED`.
  2. Tất cả các chương đã được Admin phê duyệt `APPROVED`.
  3. Không có chỉnh sửa nào đang ở trạng thái `PENDING`.
  4. Không có chỉnh sửa nào đang ở trạng thái `CHANGES_REQUESTED`.
  5. Không có xung đột phê duyệt (`REOPENED` / overlap conflict).
- **Hiệu năng**: Tính toán bằng single aggregate SQL query (zero N+1 query loops).

---

## 💾 Sao lưu & Khôi phục (Backup & Restore)

### 1. Xuất / Nhập dữ liệu dev (SQLite sang PostgreSQL)
- Xuất dữ liệu từ SQLite:
  ```bash
  npm run db:export-sqlite
  ```
  Dữ liệu được lưu vào file JSON có cấu trúc tại `data/sqlite_export.json`.
- Nhập dữ liệu vào PostgreSQL:
  ```bash
  npm run db:import-postgres
  ```

### 2. Backup & Restore Production (PostgreSQL / Supabase)
- **Dump database bằng `pg_dump`**:
  ```bash
  pg_dump -h db.YOUR_PROJECT.supabase.co -U postgres -d postgres -F c -b -v -f lilybeta_backup_$(date +%Y%m%d).dump
  ```
- **Restore database bằng `pg_restore`**:
  ```bash
  pg_restore -h db.YOUR_PROJECT.supabase.co -U postgres -d postgres -v -c lilybeta_backup_20260827.dump
  ```
- **Supabase Daily Backups**: Có thể bật tính năng tự động sao lưu Point-in-Time Recovery (PITR) trong Supabase Dashboard Settings -> Database -> Backups.

---

## 🧪 Kiểm thử Hệ thống (Testing Suite)

```bash
# Chạy toàn bộ 8 bộ test tự động (bao gồm IDOR, Workflow, Revisions, Reviews, Egress, Readiness)
npm test

# Chạy riêng kiểm thử Readiness & End-to-End Flow (61 bước)
npm run test:readiness

# Chạy kiểm thử PostgreSQL Parity (nếu có DATABASE_URL kết nối PostgreSQL)
npm run test:postgres

# Build kiểm tra kiểu dữ liệu TypeScript & bundle Frontend
npm run build
```

---

## ⛔ Out of Scope (Tính năng cố tình KHÔNG làm trong Phase 5)
Theo đúng tôn chỉ kiến trúc, các tính năng sau **không** nằm trong phạm vi Phase 5:
- Tích hợp trực tiếp LilyEditor $\to$ LilyBeta.
- Tự động publish LilyBeta $\to$ LilyHub.
- Đổi Client React sang kết nối trực tiếp bảng Supabase (giữ nguyên API backend để bảo vệ authorization và IDOR).
- AI Beta / AI Auto-Review.
- Payment / Public Sign-up.

## Phase 5.5 — Editor Sync (additive, optional)

Manual upload/import and all existing Beta/Review/Approve workflows remain available without Editor configuration. The new integration uses separate mapping tables and server-only credentials. See [contract, safety rules, setup and verification](docs/phase-5.5-editor-sync.md). No automatic replacement of manuscripts with existing Beta work is allowed.

### Mở như app trên điện thoại

Mở LilyBeta bằng Safari (iPhone) hoặc Chrome (Android), chọn **Thêm vào màn hình chính / Cài đặt ứng dụng**, rồi mở từ icon LilyBeta. Manifest dùng `standalone` để không hiển thị thanh địa chỉ trong cửa sổ đã cài; tab trình duyệt thông thường vẫn có thanh địa chỉ. Nếu đã tạo shortcut trước bản cập nhật, thêm lại icon để nhận cấu hình mới (không xóa dữ liệu trang web/bản nháp).

Giao diện dùng chiều cao viewport ổn định và ô nhập tối thiểu 16px trên mobile để hạn chế tự zoom. Vẫn giữ pinch zoom và chọn chữ cho khả năng đọc/hiệu đính. Không thêm service worker/cache API: việc cài ra màn hình chính không làm thay đổi đồng bộ, đăng nhập hay cơ chế lưu bản nháp hiện tại, và không đồng nghĩa toàn bộ app hoạt động offline. Cần kiểm tra cài đặt/keyboard trên thiết bị iOS và Android thật sau rollout.

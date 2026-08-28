import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), {
    name: 'synthetic-export-api',
    configureServer(server) {
      server.middlewares.use('/api/', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') return res.end(JSON.stringify({ chapters: Array.from({ length: 305 }, (_, i) => ({ id: `c${i + 1}`, chapterNumber: i + 1, title: `Chương ${i + 1}`, snapshotVersion: 1, status: i >= 100 && i < 105 ? 'APPROVED' : 'IN_REVIEW' })) }));
        let body = ''; req.on('data', part => { body += part; }); req.on('end', () => {
          const selected = JSON.parse(body).chapters[0];
          res.end(JSON.stringify({ book: { title: 'Truyện thử nghiệm' }, chapters: [{ chapterNumber: Number(selected.id.slice(1)), title: `Chương ${selected.id.slice(1)}`, content: 'Chàng nhìn nàng.\n\nĐây là nội dung đã được duyệt để thử xuất file.' }] }));
        });
      });
    },
  }],
  optimizeDeps: { entries: ['tests/export-ui.html'] },
  server: { host: '127.0.0.1', port: 3416, strictPort: true, headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3416; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'" } },
});

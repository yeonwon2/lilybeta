// Local-only browser harness. The test Vite config intercepts all API calls.
import { createRoot } from 'react-dom/client';
import { ExportApproved } from '../src/exports/ExportApproved';
import '../src/index.css';
createRoot(document.getElementById('root')!).render(<main className="p-6"><h1 className="text-lg font-bold mb-4">Xuất file — dữ liệu thử nghiệm cục bộ</h1><ExportApproved bookId="synthetic" assignmentId="synthetic-reader" readerName="Beta thử nghiệm" currentChapter={101} /></main>);

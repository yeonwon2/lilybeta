import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { exportDocument, MAX_EXPORT_BYTES, type ExportFormat } from './documentExport';

type Props = { bookId: string; assignmentId: string; readerName: string; currentChapter: number };
export function ExportApproved({ bookId, assignmentId, readerName, currentChapter }: Props) {
  const [format, setFormat] = useState<ExportFormat>('txt');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const path = `/admin/books/${encodeURIComponent(bookId)}/approved-export`;
  async function show() {
    setOpen(true); setBusy(true); setMessage('Đang đọc danh sách trạng thái duyệt…');
    try {
      const result = await api.get<any>(`${path}/chapters?assignmentId=${encodeURIComponent(assignmentId)}`);
      if (!alive.current) return;
      setRows(result.chapters);
      setSelected(new Set(result.chapters.filter((r: any) => r.status === 'APPROVED' && r.chapterNumber === currentChapter).map((r: any) => r.id)));
      setMessage('');
    } catch (err: any) { if (alive.current) setMessage(err.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function download() {
    const chosen = rows.filter(r => selected.has(r.id) && r.status === 'APPROVED');
    if (!chosen.length || chosen.length > 1000) { setMessage('Chọn 1–1000 chương đã duyệt.'); return; }
    setBusy(true);
    const exported: any[] = [], errors: string[] = [];
    let book: any, bytes = 0;
    try {
      for (let i = 0; i < chosen.length; i++) {
        if (!alive.current) return;
        setMessage(`Đang xuất ${i + 1}/${chosen.length}…`);
        const row = chosen[i];
        try {
          const result = await api.post<any>(`${path}/export`, { assignmentId, chapters: [{ id: row.id, snapshotVersion: row.snapshotVersion }] });
          book = result.book;
          for (const chapter of result.chapters) {
            if (chapter.error) errors.push(`${row.chapterNumber}: ${chapter.error}`);
            else { bytes += new TextEncoder().encode(chapter.content).length; exported.push(chapter); }
          }
        } catch (err: any) { errors.push(`${row.chapterNumber}: ${err.message}`); }
        if (bytes > MAX_EXPORT_BYTES) throw new Error('Nội dung vượt giới hạn 10 MB. Hãy chọn ít chương hơn.');
      }
      if (!alive.current) return;
      if (!exported.length) throw new Error(errors.join('\n') || 'Không có chương hợp lệ.');
      setMessage(`Đang tạo file ${format.toUpperCase()}…`);
      const data = await exportDocument(exported, format, book.title);
      if (!alive.current) return;
      const url = URL.createObjectURL(data);
      const link = document.createElement('a'); link.href = url;
      link.download = `${book.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'Truyen'}_${exported[0].chapterNumber}-${exported.at(-1).chapterNumber}.${format}`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(`Đã xuất ${exported.length}/${chosen.length} chương.${errors.length ? '\nĐÃ LOẠI CÁC CHƯƠNG:\n' + errors.join('\n') : ''}`);
    } catch (err: any) { if (alive.current) setMessage(err.message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <>
    <button className="px-3 py-2 text-xs rounded-xl border border-ink-200 hover:bg-ink-50" disabled={!assignmentId} onClick={show}>Xuất file</button>
    {open && <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Xuất file">
      <div className="bg-white rounded-2xl p-5 w-full max-w-xl max-h-[90dvh] overflow-auto space-y-4">
        <h2 className="font-bold text-lg">Xuất file</h2>
        <p className="text-sm">Chỉ xuất nội dung đã duyệt của <strong>{readerName}</strong>. Chọn chương và tải file về thiết bị.</p>
        <label className="block text-sm">Định dạng
          <select aria-label="Định dạng xuất" className="border rounded-lg p-2 ml-3" value={format} disabled={busy} onChange={e => setFormat(e.target.value as ExportFormat)}>
            <option value="txt">TXT — nhập vào LilyHub</option><option value="docx">Word (.docx)</option><option value="pdf">PDF</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-3 text-sm">
          <button disabled={busy} onClick={() => setSelected(new Set(rows.filter(r => r.status === 'APPROVED' && r.chapterNumber === currentChapter).map(r => r.id)))}>Chương hiện tại</button>
          <button disabled={busy} onClick={() => setSelected(new Set(rows.filter(r => r.status === 'APPROVED').map(r => r.id)))}>Chọn tất cả đã duyệt</button>
          <button disabled={busy} onClick={() => setSelected(new Set())}>Bỏ chọn</button>
        </div>
        <div className="max-h-64 overflow-auto border rounded-xl p-3 space-y-2">
          {!rows.some(row => row.status === 'APPROVED') && <p className="text-sm text-ink-500">Chưa có chương đã duyệt để xuất.</p>}
          {rows.filter(row => row.status === 'APPROVED').map(row => <label key={row.id} className="flex gap-2 text-sm items-start">
            <input type="checkbox" disabled={busy || row.status !== 'APPROVED'} checked={selected.has(row.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} />
            <span>{row.chapterNumber} — {row.title} — {row.status === 'APPROVED' ? 'Đã duyệt' : 'Chưa duyệt'}</span>
          </label>)}
        </div>
        <p role="status" className="text-sm whitespace-pre-wrap max-h-40 overflow-auto">{message}</p>
        <div className="flex justify-end gap-3">
          <button disabled={busy} onClick={() => setOpen(false)}>Đóng</button>
          <button className="px-4 py-2 bg-purple-700 text-white rounded-xl disabled:opacity-50" disabled={busy || !selected.size} onClick={download}>Xuất {selected.size} chương đã chọn</button>
        </div>
      </div>
    </div>}
  </>;
}

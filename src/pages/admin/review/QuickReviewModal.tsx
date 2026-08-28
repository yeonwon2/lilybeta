import { useEffect, useRef, useState } from 'react';
import { api } from '../../../services/api';
import { quickReviewChapters, type QuickResult } from '../../../beta-review/quickReview';

type Chapter = { chapterIndex: number; chapterTitle: string; isBetaCompleted: boolean; reviewStatus: string; pendingEdits: number; changesRequestedEdits: number };
export function QuickReviewModal({ bookId, assignmentId, chapters, currentChapterIndex, readerName, onClose, onComplete }: {
  bookId: string; assignmentId: string; chapters: Chapter[]; currentChapterIndex: number; readerName: string; onClose: () => void; onComplete: () => Promise<void>;
}) {
  const eligible = chapters.filter(c => c.isBetaCompleted && c.reviewStatus !== 'APPROVED' && !c.changesRequestedEdits);
  const [selected, setSelected] = useState<number[]>(eligible.some(c => c.chapterIndex === currentChapterIndex) ? [currentChapterIndex] : []);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<QuickResult[]>([]);
  const alive = useRef(true);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function start(indices: number[]) {
    setBusy(true);
    setResults(previous => previous.filter(r => !indices.includes(r.chapterIndex)));
    try {
      await quickReviewChapters(api, bookId, assignmentId, indices, result => {
        if (alive.current) setResults(previous => [...previous, result]);
      }, () => alive.current);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    // Dismiss immediately; refreshing the workspace must not keep the dialog open.
    onClose();
    if (results.length) void onComplete().catch(error => console.error('Không thể cập nhật tổng quan sau duyệt:', error));
  }
  const failed = results.filter(r => r.status === 'FAILED').map(r => r.chapterIndex);
  return <div onClick={e => { if (e.target === e.currentTarget) close(); }} className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-3">
    <section ref={dialog} tabIndex={-1} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || []);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first.focus(); }
    }} role="dialog" aria-modal="true" aria-labelledby="quick-review-title" className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90dvh] overflow-y-auto p-5 space-y-4">
      <div className="flex items-center justify-between gap-3"><h2 id="quick-review-title" className="text-xl font-bold">Duyệt nhanh</h2><button type="button" aria-label="Đóng bảng duyệt nhanh" disabled={busy} onClick={close} className="px-3 py-2 rounded-lg hover:bg-slate-100 disabled:opacity-50">✕</button></div>
      <p className="text-sm text-slate-600">Beta: {readerName}. Chấp nhận các đề xuất đang chờ và phê duyệt những chương bạn chọn. Giữ nguyên phần đã từ chối; bỏ qua chương chưa hoàn thành, đã duyệt hoặc đang yêu cầu sửa lại.</p>
      {!results.length && !busy && <>
        <div className="flex flex-wrap gap-3 text-sm text-indigo-700">
          <button onClick={() => setSelected(eligible.map(c => c.chapterIndex))}>Chọn tất cả đã hoàn thành ({eligible.length})</button>
          <button onClick={() => setSelected([])}>Bỏ chọn</button>
        </div>
        <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
          {eligible.length === 0 && <p className="p-4 text-slate-500">Không có chương đủ điều kiện duyệt nhanh.</p>}
          {eligible.map(c => <label key={c.chapterIndex} className="flex items-center gap-3 p-3 cursor-pointer">
            <input type="checkbox" checked={selected.includes(c.chapterIndex)} onChange={e => setSelected(previous => e.target.checked ? [...previous, c.chapterIndex] : previous.filter(i => i !== c.chapterIndex))} />
            <span className="min-w-0 text-sm">Chương {c.chapterIndex}: {c.chapterTitle}<span className="block text-xs text-slate-500">{c.pendingEdits} đề xuất đang chờ</span></span>
          </label>)}
        </div>
        <label className="flex gap-3 text-sm bg-amber-50 p-3 rounded-lg"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Tôi xác nhận chấp nhận toàn bộ đề xuất đang chờ trong các chương đã chọn và phê duyệt để xuất bản duyệt.</label>
      </>}
      {(busy || results.length > 0) && <div aria-live="polite" className="space-y-2 text-sm">
        <p className="font-semibold">{busy ? 'Đang xử lý… Không đóng trang.' : 'Đã xử lý xong lượt duyệt.'} {results.filter(r => r.status === 'APPROVED').length} chương được duyệt.</p>
        {results.map(r => <p key={r.chapterIndex} className={r.status === 'FAILED' ? 'text-red-700' : 'text-green-700'}>Chương {r.chapterIndex}: {r.message}</p>)}
      </div>}
      <div className="flex flex-wrap justify-end gap-3">
        <button disabled={busy} className="px-4 py-2 border rounded-lg disabled:opacity-50" type="button" onClick={close}>Đóng</button>
        {!results.length && <button disabled={busy || !confirmed || !selected.length} className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50" onClick={() => start([...selected].sort((a,b) => a-b))}>Chấp nhận &amp; duyệt {selected.length} chương</button>}
        {!!failed.length && <button disabled={busy} className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50" onClick={() => start(failed)}>Thử lại {failed.length} chương chưa duyệt</button>}
      </div>
    </section>
  </div>;
}

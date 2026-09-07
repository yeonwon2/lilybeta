import React from 'react';
import { X } from 'lucide-react';
import type { Book } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  book: Book;
}

export const PronounRulesDialog: React.FC<Props> = ({ open, onClose, book }) => {
  if (!open) return null;
  const general = book.pronounRules || [];
  const pairs = book.contextualPronounRules || [];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 font-sans" role="dialog" aria-modal="true" aria-labelledby="pronoun-rules-title" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85dvh] overflow-y-auto rounded-3xl bg-white p-5 sm:p-6 text-slate-900 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 id="pronoun-rules-title" className="text-lg font-bold">Quy tắc xưng hô</h2>
            <p className="mt-1 text-xs text-slate-500">Áp dụng cho toàn bộ truyện “{book.title}”.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng bảng quy tắc" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <section className="mt-5 space-y-3">
          <h3 className="font-bold text-violet-800">Bảng quy tắc chung</h3>
          {!general.length ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Không có quy tắc chung được gửi từ Editor.</p> : general.map((rule, index) => (
            <div key={`${rule.name}-${index}`} className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
              <p className="text-sm font-semibold">{rule.name}</p>
              <p className="mt-1 text-xs text-slate-700"><span className="font-medium">Từ gốc:</span> {rule.from_words.join(', ') || '—'}</p>
              <p className="mt-1 text-xs text-slate-700"><span className="font-medium">Dùng:</span> {rule.to_words.join(', ') || '—'}</p>
            </div>
          ))}
        </section>

        <section className="mt-6 space-y-3">
          <h3 className="font-bold text-violet-800">Xưng hô đôi A–B</h3>
          {!pairs.length ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Không có quy tắc theo cặp được gửi từ Editor.</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">Người nói</th><th className="p-3">Người nghe</th><th className="p-3">Tự xưng</th><th className="p-3">Gọi đối phương</th><th className="p-3">Ghi chú</th></tr></thead>
                <tbody>{pairs.map((rule, index) => <tr key={`${rule.speaker}-${rule.listener}-${index}`} className="border-t border-slate-100 align-top"><td className="p-3 font-semibold">{rule.speaker}</td><td className="p-3">{!rule.listener || rule.listener === '*' ? 'Mặc định' : rule.listener}</td><td className="p-3">{rule.self_word}</td><td className="p-3">{rule.target_word}</td><td className="p-3 text-slate-500">{rule.note || '—'}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
        <div className="mt-6 flex justify-end"><button type="button" onClick={onClose} className="rounded-xl bg-violet-700 px-5 py-2.5 text-xs font-bold text-white hover:bg-violet-800">Đóng và tiếp tục beta</button></div>
      </div>
    </div>
  );
};

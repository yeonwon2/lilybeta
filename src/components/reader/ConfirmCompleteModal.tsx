import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Edit3, Check, Trash2, Loader2 } from 'lucide-react';
import { useReader } from '../../context/ReaderContext';
import { DraftStore, EditDraft } from '../../beta-edit/draftStore';

export const ConfirmCompleteModal: React.FC = () => {
  const { 
    book,
    isConfirmCompleteOpen, 
    setIsConfirmCompleteOpen, 
    currentChapterIndex, 
    currentChapter, 
    markCurrentChapterCompleted,
    edits,
    isAutosaving,
    isEditSaving,
    editSaveError,
    currentUserId,
  } = useReader();

  const [chapterDrafts, setChapterDrafts] = useState<EditDraft[]>([]);
  const [isDiscarding, setIsDiscarding] = useState<boolean>(false);

  const refreshDrafts = () => {
    if (!book) return;
    const list = DraftStore.listDraftsForChapter(currentUserId, book.id, currentChapterIndex);
    setChapterDrafts(list);
  };

  useEffect(() => {
    if (!isConfirmCompleteOpen || !book) return;
    refreshDrafts();
  }, [isConfirmCompleteOpen, book, currentChapterIndex, currentUserId]);

  if (!isConfirmCompleteOpen) return null;

  const hasUnsavedDraft = chapterDrafts.length > 0;
  const canComplete = !hasUnsavedDraft && !isEditSaving;

  const handleDiscardAllDrafts = () => {
    if (!book) return;
    if (window.confirm(`Bạn có chắc muốn xóa bỏ tất cả ${chapterDrafts.length} bản nháp chưa lưu trong chương này để hoàn tất beta?`)) {
      setIsDiscarding(true);
      try {
        DraftStore.discardAllDraftsForChapter(currentUserId, book.id, currentChapterIndex);
        refreshDrafts();
      } finally {
        setIsDiscarding(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-3xl max-w-sm w-full shadow-2xl border border-ink-100 p-6 space-y-4 animate-in zoom-in-95 duration-150 text-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>

        <div className="text-center space-y-1.5">
          <h3 className="font-serif font-bold text-lg text-ink-900">
            Xác nhận hoàn thành chương {currentChapterIndex}?
          </h3>
          <p className="text-xs text-ink-600 font-medium truncate">
            {currentChapter?.title}
          </p>

          {/* Edit summary */}
          <div className="pt-2 flex items-center justify-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-purple-50 text-purple-800 font-semibold border border-purple-100">
              <Edit3 className="w-3 h-3 text-purple-600" />
              <span>{edits.length} chỉnh sửa</span>
            </span>
          </div>

          {/* Unsaved draft warning */}
          {hasUnsavedDraft ? (
            <div className="mt-3 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-2 text-left">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Chưa thể hoàn tất chương:</p>
                  <p className="text-[11px] text-rose-700 leading-relaxed">
                    Còn <strong>{chapterDrafts.length} bản nháp chưa lưu</strong> trong chương này. Hãy lưu hoặc bỏ bản nháp trước khi hoàn tất.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDiscardAllDrafts}
                disabled={isDiscarding}
                className="w-full py-1.5 px-3 bg-white hover:bg-rose-100/80 border border-rose-300 text-rose-800 font-semibold rounded-xl text-[11px] transition flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                <span>Bỏ {chapterDrafts.length} bản nháp để hoàn tất</span>
              </button>
            </div>
          ) : isEditSaving ? (
            <div className="mt-3 p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-800 text-xs flex items-center justify-center gap-2 font-medium">
              <Loader2 className="w-4 h-4 animate-spin text-purple-700" />
              <span>Đang lưu chỉnh sửa lên cloud...</span>
            </div>
          ) : editSaveError ? (
            <div className="mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2 text-left">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>Lỗi lưu chỉnh sửa: {editSaveError}. Vui lòng thử lại.</span>
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-emerald-700 bg-emerald-50/70 border border-emerald-200/60 p-2.5 rounded-2xl flex items-center justify-center gap-1 font-medium">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Tất cả thay đổi đã được lưu an toàn ✓</span>
            </div>
          )}
        </div>

        <div className="pt-2 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setIsConfirmCompleteOpen(false)}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold text-ink-600 hover:bg-ink-100 transition"
          >
            Quay lại
          </button>
          <button
            type="button"
            disabled={!canComplete}
            onClick={() => markCurrentChapterCompleted()}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold bg-purple-900 hover:bg-purple-950 disabled:opacity-40 disabled:hover:bg-purple-900 text-white shadow-xs transition flex items-center justify-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Xác nhận xong</span>
          </button>
        </div>
      </div>
    </div>
  );
};

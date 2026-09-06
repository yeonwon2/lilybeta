import React, { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Check,
  ShieldAlert,
  RotateCcw,
} from 'lucide-react';
import { ReaderProvider, useReader } from '../../context/ReaderContext';
import { ReaderToolbar } from '../../components/reader/ReaderToolbar';
import { AaSettingsSheet } from '../../components/reader/AaSettingsSheet';
import { ThemeSelectorSheet } from '../../components/reader/ThemeSelectorSheet';
import { TocDrawer } from '../../components/reader/TocDrawer';
import { ConfirmCompleteModal } from '../../components/reader/ConfirmCompleteModal';
import { Watermark } from '../../components/reader/Watermark';
import { applyEditsToParagraph } from '../../beta-edit/applyEdits';
import { BetaEdit } from '../../beta-edit/editTypes';

export interface BetaReaderViewProps {
  bookId: string;
  initialChapterIndex: number;
  onBackToBook: () => void;
}

// Reconstruct the paragraph's current working text (original + any active edits applied).
const getWorkingText = (original: string, paraEdits: BetaEdit[]): string => {
  if (paraEdits.length === 0) return original;
  try {
    return applyEditsToParagraph(original, paraEdits).map(seg => seg.text).join('');
  } catch {
    return original;
  }
};

const BetaReaderViewContent: React.FC<BetaReaderViewProps> = ({
  bookId,
  initialChapterIndex,
  onBackToBook,
}) => {
  const {
    book,
    currentChapterIndex,
    currentChapter,
    totalChapters,
    settings,
    activeTheme,
    isLoadingChapter,
    readerError,
    workflowMap,
    nextChapter,
    prevChapter,
    toggleToolbar,
    triggerAutosave,
    setIsConfirmCompleteOpen,
    initReader,
    edits,
    viewMode,
    saveNewEdit,
    updateExistingEdit,
    revertEdit,
  } = useReader();

  const containerRef = useRef<HTMLDivElement>(null);
  const [editingParagraphIndex, setEditingParagraphIndex] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<string>('');

  // Initialize reader for book and chapter
  useEffect(() => {
    initReader(bookId, initialChapterIndex);
  }, [bookId, initialChapterIndex]);

  // Close any in-progress edit when switching chapters
  useEffect(() => {
    setEditingParagraphIndex(null);
  }, [currentChapterIndex]);

  // Autosave scroll tracking
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) return;

      const scrollPercent = Math.min(100, Math.max(0, (scrollY / scrollHeight) * 100));
      triggerAutosave(scrollPercent, scrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [triggerAutosave]);

  // Handle click on reading area to toggle toolbar
  const handleContentClick = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    toggleToolbar();
  };

  // Click directly on a paragraph to start editing it in place — no selection needed.
  const handleStartEditing = (e: React.MouseEvent, pIdx: number, original: string, paraEdits: BetaEdit[]) => {
    e.stopPropagation();
    setEditingDraft(getWorkingText(original, paraEdits));
    setEditingParagraphIndex(pIdx);
  };

  // Auto-save the paragraph on blur: diff against the baseline and persist as one edit.
  const handleFinishEditing = async (pIdx: number, original: string, paraEdits: BetaEdit[]) => {
    const draft = editingDraft;
    setEditingParagraphIndex(null);

    const baseline = getWorkingText(original, paraEdits);
    const cleanDraft = draft.trim();
    if (!cleanDraft || cleanDraft === baseline.trim()) return;

    try {
      const wholeParagraphEdit = paraEdits.length === 1 && paraEdits[0].startOffset === 0 && paraEdits[0].endOffset === original.length
        ? paraEdits[0]
        : null;

      if (wholeParagraphEdit) {
        if (cleanDraft === original.trim()) {
          await revertEdit(wholeParagraphEdit);
        } else {
          await updateExistingEdit(wholeParagraphEdit.id, {
            proposedText: cleanDraft,
            errorType: wholeParagraphEdit.errorType || 'OTHER',
            reason: wholeParagraphEdit.reason,
            expectedVersion: wholeParagraphEdit.version,
          });
        }
      } else {
        // No edit yet, or legacy partial-range edits — consolidate into one whole-paragraph edit.
        for (const edit of paraEdits) {
          await revertEdit(edit);
        }
        if (cleanDraft !== original.trim()) {
          await saveNewEdit({
            paragraphIndex: pIdx,
            startOffset: 0,
            endOffset: original.length,
            originalText: original,
            proposedText: cleanDraft,
            errorType: 'OTHER',
          });
        }
      }
    } catch (err: any) {
      alert(err?.message || 'Không thể lưu chỉnh sửa, vui lòng thử lại.');
    }
  };

  const resizeTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // If unauthorized / IDOR barrier
  if (readerError && readerError.includes('quyền')) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#FAF8F5]">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-rose-200 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-ink-900">Truy cập bị từ chối (403)</h2>
          <p className="text-xs text-ink-600 leading-relaxed">
            {readerError}
          </p>
          <button
            onClick={onBackToBook}
            className="px-5 py-2.5 bg-ink-900 text-white rounded-xl text-xs font-semibold hover:bg-black transition"
          >
            Quay lại danh sách truyện
          </button>
        </div>
      </div>
    );
  }

  // Page width styling
  const maxWidthClass = {
    narrow: 'max-w-xl',
    normal: 'max-w-2xl',
    wide: 'max-w-3xl',
    full: 'max-w-4xl',
  }[settings.pageWidth || 'normal'];

  const currentWorkflow = workflowMap[currentChapterIndex];
  const isCompleted = currentWorkflow?.status === 'COMPLETED';

  // Render a paragraph's edited segments with a status color per review state
  const renderParagraphContent = (p: string, paraEdits: BetaEdit[]) => {
    if (viewMode === 'original') {
      return p;
    }

    try {
      const segments = applyEditsToParagraph(p, paraEdits);

      return (
        <>
          {segments.map((seg, sIdx) => {
            if (!seg.isEdited || !seg.edit) {
              return <React.Fragment key={sIdx}>{seg.text}</React.Fragment>;
            }

            const edit = seg.edit;
            const reviewStatus = edit.reviewStatus || 'PENDING';
            let styleClass = 'border-b-2 border-purple-500/80 bg-purple-500/10 text-purple-950';
            let statusDot = (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500 ml-1 align-middle"
                title="Đang chờ duyệt"
              />
            );

            if (reviewStatus === 'ACCEPTED') {
              styleClass = 'border-b-2 border-emerald-500/80 bg-emerald-500/10 text-emerald-950';
              statusDot = (
                <span
                  className="inline-block text-[10px] text-emerald-600 font-bold ml-1 align-middle"
                  title="Đã chấp nhận"
                >
                  ✓
                </span>
              );
            } else if (reviewStatus === 'CHANGES_REQUESTED') {
              styleClass = 'border-b-2 border-amber-500 bg-amber-500/15 text-amber-950';
              statusDot = (
                <span
                  className="inline-block text-[10px] text-amber-600 font-bold ml-1 align-middle"
                  title="Admin yêu cầu chỉnh lại"
                >
                  !
                </span>
              );
            } else if (reviewStatus === 'REJECTED') {
              styleClass = 'border-b-2 border-rose-400/60 bg-rose-400/10 text-rose-900 line-through opacity-80';
              statusDot = (
                <span
                  className="inline-block text-[10px] text-rose-500 font-bold ml-1 align-middle"
                  title="Bị từ chối"
                >
                  ×
                </span>
              );
            }

            return (
              <span
                key={edit.id || sIdx}
                className={`px-0.5 rounded inline-block font-medium ${styleClass}`}
                title={`Đã sửa: "${edit.originalText}" → "${edit.currentText}" [${reviewStatus}]`}
              >
                {seg.text}
                {statusDot}
              </span>
            );
          })}
        </>
      );
    } catch (err) {
      console.warn('Error applying edits to paragraph:', err);
      return p;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`min-h-screen transition-colors duration-200 ${activeTheme.className}`}
      style={{
        backgroundColor: 'var(--reader-bg)',
        color: 'var(--reader-text)',
      }}
      onClick={handleContentClick}
    >
      {/* Floating Toolbars */}
      <ReaderToolbar onBack={onBackToBook} />

      {/* Floating Sheets & Drawers */}
      <AaSettingsSheet />
      <ThemeSelectorSheet />
      <TocDrawer />
      <ConfirmCompleteModal />

      {/* Watermark for Accountability Deterrence */}
      <Watermark />

      {/* Reading Article */}
      <main
        className={`${maxWidthClass} mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-28 sm:pb-36 transition-all duration-150`}
        style={{
          fontFamily: `"${settings.fontFamily}", serif`,
          paddingLeft: `${Math.max(16, settings.marginHorizontal)}px`,
          paddingRight: `${Math.max(16, settings.marginHorizontal)}px`,
        }}
      >
        {isLoadingChapter ? (
          <div className="py-32 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-purple-700" />
            <p className="text-xs opacity-75 font-sans">Đang tải nội dung bản thảo...</p>
          </div>
        ) : readerError ? (
          <div className="p-8 rounded-3xl bg-rose-50/50 border border-rose-200 text-rose-900 text-center text-xs space-y-3 font-sans">
            <p>{readerError}</p>
            <button
              onClick={onBackToBook}
              className="px-4 py-2 bg-ink-900 text-white rounded-xl text-xs font-semibold"
            >
              Quay lại mục lục
            </button>
          </div>
        ) : currentChapter ? (
          <article className="space-y-8 animate-in fade-in duration-200">
            {/* Chapter Header */}
            <div className="text-center pb-8 border-b border-ink-200/40 space-y-2">
              <div className="flex items-center justify-center gap-2">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-widest opacity-60 font-sans">
                  Chương {currentChapter.index} / {totalChapters}
                </span>
                {isCompleted && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-sans font-bold px-2 py-0.5 rounded-full bg-emerald-100/80 text-emerald-800 border border-emerald-300">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>Đã beta xong</span>
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug">
                {currentChapter.title}
              </h1>

              <div className="flex items-center justify-center gap-3 text-[11px] opacity-60 font-sans">
                <span className="font-mono">{currentChapter.wordCount.toLocaleString('vi-VN')} chữ</span>
                {viewMode === 'working' && edits.length > 0 && (
                  <span className="text-purple-700 dark:text-purple-300 font-semibold">
                    · Đang hiển thị {edits.length} chỉnh sửa
                  </span>
                )}
                {viewMode === 'original' && (
                  <span className="text-amber-700 dark:text-amber-300 font-semibold">
                    · Đang xem bản gốc nguyên tác
                  </span>
                )}
              </div>
            </div>

            {/* Paragraphs — click anywhere on the text to edit it directly, no selection needed */}
            <div
              className="reader-prose space-y-5"
              style={{
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
                textAlign: settings.textAlign,
              }}
            >
              {currentChapter.paragraphs && currentChapter.paragraphs.length > 0 ? (
                currentChapter.paragraphs.map((p, idx) => {
                  const paraEdits = edits.filter(e => e.paragraphIndex === idx && e.status === 'ACTIVE');
                  const isEditing = editingParagraphIndex === idx;

                  return (
                    <div key={idx} data-paragraph-index={idx} data-original-text={p}>
                      {isEditing ? (
                        <textarea
                          autoFocus
                          value={editingDraft}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            setEditingDraft(e.target.value);
                            resizeTextarea(e.currentTarget);
                          }}
                          onBlur={() => handleFinishEditing(idx, p, paraEdits)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') e.currentTarget.blur();
                          }}
                          ref={resizeTextarea}
                          rows={1}
                          className={`w-full resize-none bg-purple-500/5 outline-none ring-2 ring-purple-400/50 rounded-md px-1 -mx-1 ${settings.firstLineIndent ? 'indent-6' : ''}`}
                          style={{
                            color: 'inherit',
                            textAlign: settings.textAlign,
                            marginBottom: `${(settings.paragraphSpacing - 1) * 1.5}rem`,
                          }}
                        />
                      ) : (
                        <>
                          <p
                            onClick={(e) => handleStartEditing(e, idx, p, paraEdits)}
                            className={`cursor-text rounded-md transition hover:bg-purple-500/5 ${settings.firstLineIndent ? 'indent-6' : ''}`}
                            style={{ marginBottom: paraEdits.length > 0 ? undefined : `${(settings.paragraphSpacing - 1) * 1.5}rem` }}
                          >
                            {renderParagraphContent(p, paraEdits)}
                          </p>
                          {paraEdits.length > 0 && viewMode === 'working' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                paraEdits.forEach(edit => revertEdit(edit));
                              }}
                              className="mt-0.5 text-[10px] text-ink-400 hover:text-rose-600 font-sans font-medium inline-flex items-center gap-0.5 transition"
                              style={{ marginBottom: `${(settings.paragraphSpacing - 1) * 1.5}rem` }}
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              Khôi phục nguyên văn
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="text-center opacity-50 italic text-sm py-12">
                  Chương này chưa có nội dung văn bản.
                </p>
              )}
            </div>

            {/* Chapter Completion Section */}
            <div
              className="pt-12 pb-6 border-t border-ink-200/40 space-y-6 text-center font-sans"
              onClick={(e) => e.stopPropagation()}
            >
              {isCompleted ? (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-900 inline-flex flex-col items-center gap-1.5 max-w-sm mx-auto">
                  <div className="flex items-center gap-2 font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Bạn đã hoàn thành beta chương này</span>
                  </div>
                  {currentWorkflow?.completedAt && (
                    <span className="text-[10px] text-emerald-700 font-mono">
                      Hoàn thành: {new Date(currentWorkflow.completedAt).toLocaleString('vi-VN')}
                    </span>
                  )}
                  <p className="text-[11px] text-emerald-800/80 pt-1">
                    Nếu bạn chỉnh sửa tiếp trong chương này, trạng thái sẽ tự động cập nhật về đang xử lý.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs opacity-70">
                    Đã đọc hết nội dung chương {currentChapterIndex}?
                  </p>
                  <button
                    onClick={() => setIsConfirmCompleteOpen(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-semibold text-xs shadow-md transition transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Check className="w-4 h-4" />
                    <span>Đánh dấu đã beta xong chương {currentChapterIndex}</span>
                  </button>
                </div>
              )}

              {/* Bottom Next/Prev Chapter navigation buttons */}
              <div className="flex items-center justify-between pt-4 max-w-md mx-auto">
                <button
                  onClick={prevChapter}
                  disabled={currentChapterIndex <= 1}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-ink-100/40 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Chương trước</span>
                </button>

                <button
                  onClick={nextChapter}
                  disabled={currentChapterIndex >= totalChapters}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-ink-100/40 disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  <span>Chương sau</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </article>
        ) : null}
      </main>
    </div>
  );
};

export const BetaReaderView: React.FC<BetaReaderViewProps> = (props) => {
  return (
    <ReaderProvider>
      <BetaReaderViewContent {...props} />
    </ReaderProvider>
  );
};

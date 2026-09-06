import React, { useEffect, useRef } from 'react';
import { 
  Loader2, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  Check, 
  ShieldAlert,
  MessageSquare
} from 'lucide-react';
import { ReaderProvider, useReader } from '../../context/ReaderContext';
import { ReaderToolbar } from '../../components/reader/ReaderToolbar';
import { AaSettingsSheet } from '../../components/reader/AaSettingsSheet';
import { ThemeSelectorSheet } from '../../components/reader/ThemeSelectorSheet';
import { TocDrawer } from '../../components/reader/TocDrawer';
import { ConfirmCompleteModal } from '../../components/reader/ConfirmCompleteModal';
import { Watermark } from '../../components/reader/Watermark';
import { InlineSelectionToolbar } from '../../components/reader/InlineSelectionToolbar';
import { EditBottomSheet } from '../../components/reader/EditBottomSheet';
import { EditDetailModal } from '../../components/reader/EditDetailModal';
import { RevisionHistoryDrawer } from '../../components/reader/RevisionHistoryDrawer';
import { NoteModal } from '../../components/reader/NoteModal';
import { applyEditsToParagraph } from '../../beta-edit/applyEdits';
import { ERROR_TYPE_LABELS } from '../../beta-edit/editTypes';
import { useAuth } from '../../context/AuthContext';

export interface BetaReaderViewProps {
  bookId: string;
  initialChapterIndex: number;
  onBackToBook: () => void;
}

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
    notes,
    viewMode,
    activeSelectionRange,
    setActiveSelectionRange,
    isEditSheetOpen,
    setIsEditSheetOpen,
    isDetailModalOpen,
    setIsDetailModalOpen,
    isHistoryDrawerOpen,
    setIsHistoryDrawerOpen,
    isNoteModalOpen,
    setIsNoteModalOpen,
    selectedEdit,
    setSelectedEdit,
    saveNewEdit,
    updateExistingEdit,
    revertEdit,
    saveNote,
  } = useReader();

  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize reader for book and chapter
  useEffect(() => {
    initReader(bookId, initialChapterIndex);
  }, [bookId, initialChapterIndex]);

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

  // Click directly on a paragraph to propose an edit — no need to select text first.
  const handleParagraphClick = (e: React.MouseEvent<HTMLParagraphElement>, pIdx: number, originalText: string) => {
    e.stopPropagation();
    setActiveSelectionRange({
      paragraphIndex: pIdx,
      startOffset: 0,
      endOffset: originalText.length,
      selectedText: originalText,
      rect: e.currentTarget.getBoundingClientRect(),
    });
    setSelectedEdit(null);
    setIsEditSheetOpen(true);
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

  // Render a paragraph according to viewMode (Working vs Original)
  const renderParagraphContent = (p: string, pIdx: number) => {
    if (viewMode === 'original') {
      return p;
    }

    const paraEdits = edits.filter(e => e.paragraphIndex === pIdx && e.status === 'ACTIVE');
    const paraNotes = notes.filter(n => n.paragraphIndex === pIdx);

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
            let styleClass = 'border-b-2 border-purple-500/80 bg-purple-500/10 hover:bg-purple-500/25 text-purple-950';
            let statusDot = (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500 ml-1 align-middle"
                title="Đang chờ duyệt"
              />
            );

            if (reviewStatus === 'ACCEPTED') {
              styleClass = 'border-b-2 border-emerald-500/80 bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-950';
              statusDot = (
                <span
                  className="inline-block text-[10px] text-emerald-600 font-bold ml-1 align-middle"
                  title="Đã chấp nhận"
                >
                  ✓
                </span>
              );
            } else if (reviewStatus === 'CHANGES_REQUESTED') {
              styleClass = 'border-b-2 border-amber-500 bg-amber-500/15 hover:bg-amber-500/25 text-amber-950';
              statusDot = (
                <span
                  className="inline-block text-[10px] text-amber-600 font-bold ml-1 align-middle"
                  title="Admin yêu cầu chỉnh lại"
                >
                  !
                </span>
              );
            } else if (reviewStatus === 'REJECTED') {
              styleClass = 'border-b-2 border-rose-400/60 bg-rose-400/10 hover:bg-rose-400/20 text-rose-900 line-through opacity-80';
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
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEdit(edit);
                  setIsDetailModalOpen(true);
                }}
                className={`cursor-pointer px-0.5 rounded transition inline-block font-medium select-text ${styleClass}`}
                title={`Đã sửa (${ERROR_TYPE_LABELS[edit.errorType] || edit.errorType}): ${edit.originalText} → ${edit.currentText} [${reviewStatus}]`}
              >
                {seg.text}
                {statusDot}
              </span>
            );
          })}

          {/* Paragraph notes badge */}
          {paraNotes.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 ml-2 px-1.5 py-0.5 rounded-md bg-amber-100/80 text-amber-800 text-[10px] font-sans font-bold align-middle cursor-pointer hover:bg-amber-200 transition"
              title={`${paraNotes.length} ghi chú trong đoạn này: ${paraNotes.map(n => n.note).join('; ')}`}
              onClick={(e) => {
                e.stopPropagation();
                alert(`Ghi chú đoạn ${pIdx + 1}:\n` + paraNotes.map((n, i) => `${i + 1}. ${n.note}`).join('\n'));
              }}
            >
              <MessageSquare className="w-3 h-3" />
              <span>{paraNotes.length}</span>
            </span>
          )}
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

      {/* Inline Selection Floating Toolbar (notes only — editing is a direct paragraph click) */}
      <InlineSelectionToolbar
        key={`${bookId}:${currentChapterIndex}`}
        onOpenNote={(range) => {
          setActiveSelectionRange(range);
          setIsNoteModalOpen(true);
        }}
      />

      {/* Edit Bottom Sheet / Modal */}
      <EditBottomSheet
        isOpen={isEditSheetOpen}
        onClose={() => {
          setIsEditSheetOpen(false);
          setActiveSelectionRange(null);
          setSelectedEdit(null);
        }}
        selectionRange={activeSelectionRange}
        existingEdit={selectedEdit}
        onSaveEdit={async (data) => {
          if (selectedEdit) {
            await updateExistingEdit({
              proposedText: data.proposedText,
              errorType: data.errorType,
              reason: data.reason,
              expectedVersion: data.expectedVersion,
            });
          } else {
            await saveNewEdit(data);
          }
        }}
        userId={user?.id}
        bookId={book?.id}
        chapterIndex={currentChapterIndex}
      />

      {/* Edit Detail View */}
      <EditDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedEdit(null);
        }}
        edit={selectedEdit}
        onEditAgain={(edit) => {
          setIsDetailModalOpen(false);
          setSelectedEdit(edit);
          setIsEditSheetOpen(true);
        }}
        onViewHistory={(edit) => {
          setIsDetailModalOpen(false);
          setSelectedEdit(edit);
          setIsHistoryDrawerOpen(true);
        }}
        onRevertEdit={async (edit) => {
          if (confirm('Bạn có chắc muốn hoàn tác chỉnh sửa này và đưa về nguyên tác?')) {
            await revertEdit(edit);
          }
        }}
      />

      {/* Revision History Drawer */}
      <RevisionHistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => {
          setIsHistoryDrawerOpen(false);
          setSelectedEdit(null);
        }}
        edit={selectedEdit}
        bookId={book?.id || ''}
        chapterIndex={currentChapterIndex}
      />

      {/* Selection Note Modal */}
      <NoteModal
        isOpen={isNoteModalOpen}
        onClose={() => {
          setIsNoteModalOpen(false);
          setActiveSelectionRange(null);
        }}
        selectionRange={activeSelectionRange}
        onSaveNote={async (data) => {
          await saveNote(data);
        }}
      />

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

            {/* Paragraphs */}
            <div 
              className="reader-prose space-y-5"
              style={{
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
                textAlign: settings.textAlign,
              }}
            >
              {currentChapter.paragraphs && currentChapter.paragraphs.length > 0 ? (
                currentChapter.paragraphs.map((p, idx) => (
                  <p
                    key={idx}
                    data-paragraph-index={idx}
                    data-original-text={p}
                    onClick={(e) => handleParagraphClick(e, idx, p)}
                    className={`cursor-text rounded-md transition hover:bg-purple-500/5 ${settings.firstLineIndent ? 'indent-6' : ''}`}
                    style={{ marginBottom: `${(settings.paragraphSpacing - 1) * 1.5}rem` }}
                  >
                    {renderParagraphContent(p, idx)}
                  </p>
                ))
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

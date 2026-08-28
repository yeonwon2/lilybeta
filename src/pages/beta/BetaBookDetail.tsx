import React, { useState, useEffect } from 'react';
import { api, ApiError } from '../../services/api';
import { Book, Chapter } from '../../types';
import { BookCover } from '../../components/common/BookCover';
import { BrandLogo } from '../../components/common/BrandLogo';
import { FormatBadge } from '../../components/common/Badges';
import { ArrowLeft, BookOpen, CheckCircle2, Clock, ShieldAlert, Loader2, Play, Bookmark } from 'lucide-react';

interface BetaBookDetailProps {
  bookId: string;
  onBack: () => void;
  onOpenChapter: (chapterIndex: number) => void;
}

export const BetaBookDetail: React.FC<BetaBookDetailProps> = ({ bookId, onBack, onOpenChapter }) => {
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [forbiddenError, setForbiddenError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setForbiddenError(false);
    setErrorMessage(null);

    try {
      const [bookRes, chaptersRes] = await Promise.all([
        api.get<{ book: Book }>(`/books/${bookId}`),
        api.get<{ chapters: any[] }>(`/books/${bookId}/chapters`),
      ]);

      setBook(bookRes.book);
      setChapters(chaptersRes.chapters || []);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 403) {
        setForbiddenError(true);
      } else {
        setErrorMessage(err?.message || 'Không thể tải thông tin tác phẩm.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [bookId]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FBF9F5]">
        <div className="flex flex-col items-center gap-3 text-ink-400">
          <Loader2 className="w-8 h-8 text-purple-900 animate-spin" />
          <p className="text-xs font-medium">Đang tải bản thảo...</p>
        </div>
      </div>
    );
  }

  // IDOR Barrier Screen
  if (forbiddenError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#FBF9F5]">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-rose-200 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold font-serif text-ink-950">Truy cập bị từ chối</h2>
          <p className="text-xs text-ink-600 leading-relaxed">
            Hệ thống từ chối yêu cầu. Bạn không có phân công đối với tác phẩm này. Dữ liệu chương được bảo mật tuyệt đối theo quyền truy cập.
          </p>
          <div className="pt-2">
            <button
              onClick={onBack}
              className="px-5 py-2.5 bg-ink-900 text-white rounded-xl text-xs font-semibold hover:bg-black transition"
            >
              Quay lại danh sách truyện của bạn
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (errorMessage || !book) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#FBF9F5]">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-ink-200 text-center space-y-4">
          <h2 className="text-lg font-bold font-serif text-ink-950">Đã xảy ra lỗi</h2>
          <p className="text-xs text-ink-600">{errorMessage || 'Không tìm thấy tác phẩm.'}</p>
          <button
            onClick={onBack}
            className="px-4 py-2 bg-ink-900 text-white rounded-xl text-xs font-semibold"
          >
            Quay lại
          </button>
        </div>
      </div>
    );
  }

  const currentChapterIndex = book.currentChapter ?? book.progress?.currentChapter ?? 1;
  const completedCount = book.completedChaptersCount ?? book.progress?.completedChaptersCount ?? 0;
  const progressPercent = book.progressPercent ?? book.progress?.progressPercent ?? 0;
  const isAllDone = completedCount === book.totalChapters && book.totalChapters > 0;

  return (
    <div className="min-h-screen app-bg text-ink-900 flex flex-col font-sans">
      {/* Top Bar */}
      <header className="bg-white/90 backdrop-blur-md border-b border-ink-100/80 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-ink-600 hover:text-ink-950 text-xs font-semibold py-1.5 px-2.5 rounded-xl hover:bg-ink-100 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Tủ sách của bạn</span>
          </button>
          <BrandLogo size="sm" />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full space-y-7">
        {/* Book Header Card */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-ink-100 shadow-2xs flex flex-col sm:flex-row gap-6 items-start">
          <BookCover
            title={book.title}
            author={book.author}
            coverUrl={book.coverUrl}
            coverColor={book.coverColor}
            format={book.fileFormat}
            size="md"
          />

          <div className="flex-1 min-w-0 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <FormatBadge format={book.fileFormat} />
                <span className="text-xs text-ink-400 font-mono">
                  {book.totalChapters} chương · {book.wordCount.toLocaleString('vi-VN')} chữ
                </span>
              </div>
              <h1 className="font-serif font-bold text-2xl sm:text-3xl text-ink-950 leading-snug">
                {book.title}
              </h1>
              <p className="text-sm text-ink-600 italic font-serif">{book.author}</p>
            </div>

            {/* Progress status */}
            <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-ink-100 space-y-2.5">
              <div className="flex justify-between text-xs text-ink-600">
                <span>Tiến độ đọc duyệt: <strong className="text-purple-900 font-mono">{completedCount}/{book.totalChapters} chương</strong></span>
                <span className="font-mono font-bold text-purple-900">
                  {Math.round(progressPercent)}%
                </span>
              </div>
              <div className="w-full h-2 bg-ink-200/60 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${isAllDone ? 'bg-emerald-600' : 'bg-purple-900'}`}
                  style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-ink-400 pt-1 font-mono">
                <span>Đã xong: <strong className="text-emerald-700">{completedCount} chương</strong></span>
                <span>Còn lại: <strong className="text-ink-700">{Math.max(0, book.totalChapters - completedCount)} chương</strong></span>
              </div>
            </div>

            {/* Action button */}
            <button
              onClick={() => onOpenChapter(currentChapterIndex)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-purple-900 hover:bg-purple-950 text-white rounded-2xl text-xs font-semibold shadow-xs transition transform hover:scale-[1.01] active:scale-[0.99]"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{progressPercent > 0 ? `Đọc tiếp Chương ${currentChapterIndex}` : 'Bắt đầu đọc từ Chương 1'}</span>
            </button>
          </div>
        </div>

        {/* Chapter List (Table of Contents) */}
        <div className="bg-white rounded-3xl border border-ink-100 shadow-2xs overflow-hidden">
          <div className="px-6 py-4 border-b border-ink-100 flex items-center justify-between bg-[#FAF8F5]">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-purple-900" />
              <h3 className="font-serif font-bold text-base text-ink-950">Mục lục tác phẩm ({chapters.length} chương)</h3>
            </div>
            <span className="text-xs text-ink-400 font-mono">Bấm vào chương để bắt đầu đọc</span>
          </div>

          <div className="divide-y divide-ink-100/70 text-xs">
            {chapters.map((ch) => {
              const chIdx = ch.index ?? ch.chapterIndex ?? 1;
              const isCurrent = chIdx === currentChapterIndex;
              const isCompleted = ch.status === 'COMPLETED';

              return (
                <div
                  key={chIdx}
                  onClick={() => onOpenChapter(chIdx)}
                  className={`p-4 sm:px-6 flex items-center justify-between cursor-pointer transition ${
                    isCurrent ? 'bg-purple-50/70' : 'hover:bg-[#FAF8F5]'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="font-mono text-xs text-ink-400 w-7 shrink-0">
                      #{chIdx}
                    </span>
                    <span className={`line-clamp-1 ${isCurrent ? 'text-purple-950 font-bold font-serif' : 'text-ink-800 font-medium'}`}>
                      {ch.title}
                    </span>
                    {isCompleted && (
                      <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 shrink-0 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Đã beta
                      </span>
                    )}
                    {isCurrent && !isCompleted && (
                      <span className="text-[10px] uppercase font-bold font-mono px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 shrink-0">
                        Đang đọc
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-ink-400 shrink-0 ml-4 font-mono text-[11px]">
                    <span>{ch.wordCount.toLocaleString('vi-VN')} chữ</span>
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-ink-200" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
};

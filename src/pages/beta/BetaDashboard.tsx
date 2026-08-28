import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Book } from '../../types';
import { BookCover } from '../../components/common/BookCover';
import { BrandLogo } from '../../components/common/BrandLogo';
import { FormatBadge } from '../../components/common/Badges';
import { 
  BookOpen, 
  LogOut, 
  Loader2, 
  Clock, 
  CheckCircle2, 
  ChevronRight, 
  Sparkles, 
  Bookmark, 
  Play,
  TrendingUp,
  CheckCircle
} from 'lucide-react';

interface BetaDashboardProps {
  onSelectBook: (bookId: string) => void;
}

export const BetaDashboard: React.FC<BetaDashboardProps> = ({ onSelectBook }) => {
  const { user, logout } = useAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAssignedBooks = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<{ books: Book[] }>('/books');
      setBooks(res.books || []);
    } catch (err: any) {
      setError(err?.message || 'Không thể tải danh sách truyện được giao.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAssignedBooks();
  }, []);

  // Compute personal reading stats
  const readerStats = useMemo(() => {
    let totalChapters = 0;
    let completedChapters = 0;
    books.forEach(b => {
      const bCompleted = b.completedChaptersCount ?? b.progress?.completedChaptersCount ?? 0;
      totalChapters += b.totalChapters || 0;
      completedChapters += bCompleted;
    });
    const percent = totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0;
    const completedBooks = books.filter(b => {
      const bCompleted = b.completedChaptersCount ?? b.progress?.completedChaptersCount ?? 0;
      return bCompleted === b.totalChapters && b.totalChapters > 0;
    }).length;

    return { totalChapters, completedChapters, percent, completedBooks };
  }, [books]);

  return (
    <div className="min-h-screen app-bg text-ink-900 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-white/90 backdrop-blur-md border-b border-ink-100/80 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <BrandLogo
            badge="Beta Reader"
            badgeVariant="reader"
            subtitle="Không gian đọc duyệt & hiệu đính bản thảo"
          />

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-semibold text-ink-900">{user?.displayName}</span>
              <span className="text-[10px] text-ink-400 font-mono">@{user?.username} · Độc giả Beta</span>
            </div>
            <button
              onClick={() => logout()}
              className="p-2 rounded-xl text-ink-400 hover:text-rose-600 hover:bg-rose-50 transition"
              title="Đăng xuất"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-7">
        {/* Personal Reading Desk Banner ("Tạo cảm giác chăm chỉ hơn") */}
        <div className="bg-gradient-to-br from-purple-950 via-purple-900 to-indigo-950 rounded-3xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
          {/* Subtle background decoration */}
          <div className="absolute right-0 top-0 bottom-0 w-96 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent pointer-events-none" />

          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-2 text-purple-200 text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-purple-300" />
              <span>Bàn Đọc & Biên Tập Của Bạn</span>
            </div>

            <div className="space-y-1">
              <h2 className="text-xl sm:text-3xl font-serif font-bold text-white tracking-tight">
                Chào mừng bạn, {user?.displayName}!
              </h2>
              <p className="text-xs sm:text-sm text-purple-200/90 max-w-xl leading-relaxed">
                Mỗi đóng góp, nhận xét và đề xuất sửa đổi của bạn đều giúp bản thảo trở nên hoàn thiện và chỉn chu hơn trước khi phát hành.
              </p>
            </div>

            {/* Reading stats widgets */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
                <span className="text-[11px] text-purple-200 block font-medium">Bản thảo được giao</span>
                <span className="text-lg sm:text-xl font-bold font-serif text-white">{books.length}</span>
                <span className="text-[10px] text-purple-300 block">tác phẩm</span>
              </div>

              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
                <span className="text-[11px] text-purple-200 block font-medium">Chương đã hoàn thành</span>
                <span className="text-lg sm:text-xl font-bold font-serif text-white">{readerStats.completedChapters}/{readerStats.totalChapters}</span>
                <span className="text-[10px] text-purple-300 block">chương</span>
              </div>

              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
                <span className="text-[11px] text-purple-200 block font-medium">Tiến độ chung</span>
                <span className="text-lg sm:text-xl font-bold font-serif text-white">{readerStats.percent}%</span>
                <div className="w-full h-1 bg-white/20 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${readerStats.percent}%` }} />
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
                <span className="text-[11px] text-purple-200 block font-medium">Truyện đã xong</span>
                <span className="text-lg sm:text-xl font-bold font-serif text-white">{readerStats.completedBooks}</span>
                <span className="text-[10px] text-purple-300 block">bản thảo hoàn tất</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section Heading & Shelf Filters */}
        <div className="flex items-center justify-between border-b border-ink-100/80 pb-3">
          <div className="flex items-center gap-3">
            <span className="w-1 h-6 rounded-full bg-gradient-to-b from-purple-600 to-lily-400" />
            <div>
              <h3 className="font-serif font-bold text-lg text-ink-950">Tủ sách đang đọc duyệt</h3>
              <p className="text-xs text-ink-400">Chọn tác phẩm để bắt đầu đọc và đánh dấu chỉnh sửa inline</p>
            </div>
          </div>
          <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-ink-100 text-ink-600">
            {books.length} tác phẩm
          </span>
        </div>

        {/* Assigned Books Shelf */}
        {isLoading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-ink-400">
            <Loader2 className="w-8 h-8 animate-spin text-purple-800" />
            <p className="text-xs font-medium">Đang tải tủ sách của bạn...</p>
          </div>
        ) : error ? (
          <div className="bg-white rounded-3xl p-8 text-center border border-rose-100 text-rose-800 text-xs">
            {error}
          </div>
        ) : books.length === 0 ? (
          <div className="bg-white rounded-3xl p-14 text-center border border-ink-100 space-y-4 shadow-2xs">
            <div className="w-14 h-14 rounded-3xl bg-purple-50 text-purple-700 flex items-center justify-center mx-auto">
              <BookOpen className="w-7 h-7" />
            </div>
            <h4 className="font-serif font-bold text-base text-ink-900">Bạn chưa được giao tác phẩm nào</h4>
            <p className="text-xs text-ink-500 max-w-sm mx-auto leading-relaxed">
              Khi Ban Quản Trị phân công bản thảo mới cho tài khoản của bạn, truyện sẽ ngay lập tức xuất hiện trên kệ sách này.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {books.map((b) => {
              const bCompleted = b.completedChaptersCount ?? b.progress?.completedChaptersCount ?? 0;
              const bProgress = b.progressPercent ?? b.progress?.progressPercent ?? 0;
              const isCompleted = bCompleted === b.totalChapters && b.totalChapters > 0;
              const currentChapterNum = b.currentChapter ?? b.progress?.currentChapter ?? 1;

              return (
                <div
                  key={b.id}
                  onClick={() => onSelectBook(b.id)}
                  className="bg-white rounded-3xl p-5 sm:p-6 border border-ink-100/80 shadow-2xs hover:shadow-soft hover:-translate-y-0.5 hover:border-purple-200 transition-all duration-200 cursor-pointer flex flex-col justify-between space-y-4 group"
                >
                  <div className="flex gap-4 sm:gap-5 items-start">
                    <BookCover
                      title={b.title}
                      author={b.author}
                      coverUrl={b.coverUrl}
                      coverColor={b.coverColor}
                      format={b.fileFormat}
                      size="sm"
                    />

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <FormatBadge format={b.fileFormat} />
                        {isCompleted ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Đã duyệt xong
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-purple-800 bg-purple-100 px-2 py-0.5 rounded-full">
                            Đang đọc duyệt
                          </span>
                        )}
                        <span className="text-[10px] text-ink-400 font-mono">
                          {b.totalChapters} ch. · {b.wordCount.toLocaleString('vi-VN')} chữ
                        </span>
                      </div>

                      <h4 className="font-serif font-bold text-base text-ink-950 line-clamp-2 leading-snug group-hover:text-purple-900 transition">
                        {b.title}
                      </h4>

                      <p className="text-xs text-ink-500 line-clamp-1 italic font-serif">
                        {b.author}
                      </p>

                      {/* Progress Bar with Chapters counter */}
                      <div className="pt-2 space-y-1.5">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-ink-500">
                            Tiến độ: <strong className="text-ink-900 font-mono">{bCompleted}/{b.totalChapters}</strong> chương
                          </span>
                          <span className="font-mono font-bold text-purple-900">
                            {Math.round(bProgress)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-ink-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isCompleted ? 'bg-emerald-600' : 'bg-purple-700'
                            }`}
                            style={{
                              width: `${Math.min(100, Math.max(0, bProgress))}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card bottom action & reading CTA */}
                  <div className="pt-3 border-t border-ink-100/80 flex items-center justify-between text-xs">
                    <span className="text-ink-400 text-[11px] flex items-center gap-1 font-mono">
                      <Clock className="w-3.5 h-3.5" />
                      {b.lastReadAt ? `Đọc gần nhất: ${new Date(b.lastReadAt).toLocaleDateString('vi-VN')}` : 'Chưa bắt đầu đọc'}
                    </span>

                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 text-purple-900 font-semibold group-hover:bg-purple-900 group-hover:text-white transition-all">
                      <span>{isCompleted ? 'Xem lại tác phẩm' : `Đọc tiếp Chương ${currentChapterNum}`}</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

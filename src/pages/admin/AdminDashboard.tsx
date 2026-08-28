import { AdminAccountModal } from './AdminAccountModal';
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Book, ActivityLog } from '../../types';
import { BookCover } from '../../components/common/BookCover';
import { BrandLogo } from '../../components/common/BrandLogo';
import { BookStatusBadge, FormatBadge, ActiveBadge, RoleBadge } from '../../components/common/Badges';
import { BookUploadModal } from './BookUploadModal';
import { AssignModal } from './AssignModal';
import { CreateReaderModal } from './CreateReaderModal';
import { BetaEdit, ERROR_TYPE_LABELS } from '../../beta-edit/editTypes';
import { BetaCloudBookSource } from '../../book-engine/source/BetaCloudBookSource';
import { 
  BookOpen, 
  Users, 
  History, 
  Plus, 
  UserPlus, 
  LogOut, 
  Trash2, 
  UserCheck, 
  UserX, 
  Loader2, 
  Sparkles, 
  Edit3, 
  Clock, 
  X,
  Search,
  CheckCircle2,
  TrendingUp,
  Bookmark,
  LayoutGrid,
  List
} from 'lucide-react';

interface AdminDashboardProps {
  onNavigate?: (path: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  const { user, logout } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const navigate = onNavigate || ((path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  const [activeTab, setActiveTab] = useState<'books' | 'readers' | 'logs'>('books');
  const [books, setBooks] = useState<Book[]>([]);
  const [readers, setReaders] = useState<any[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isLoadingBooks, setIsLoadingBooks] = useState(true);
  const [isLoadingReaders, setIsLoadingReaders] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'assigned' | 'unassigned' | 'completed'>('all');
  const [viewLayout, setViewLayout] = useState<'grid' | 'table'>('grid');

  // Modals state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isCreateReaderOpen, setIsCreateReaderOpen] = useState(false);
  const [assignModal, setAssignModal] = useState<{
    isOpen: boolean;
    bookId: string | null;
    bookTitle: string;
    currentAssignedUserId?: string;
  }>({
    isOpen: false,
    bookId: null,
    bookTitle: '',
  });

  // Admin Edits Inspector Modal state
  const [editsModal, setEditsModal] = useState<{
    isOpen: boolean;
    bookId: string;
    bookTitle: string;
    edits: BetaEdit[];
    isLoading: boolean;
  }>({
    isOpen: false,
    bookId: '',
    bookTitle: '',
    edits: [],
    isLoading: false,
  });

  const handleOpenEditsModal = async (bookId: string, bookTitle: string) => {
    setEditsModal({
      isOpen: true,
      bookId,
      bookTitle,
      edits: [],
      isLoading: true,
    });

    try {
      const list = await BetaCloudBookSource.getInstance().getAdminBookEdits(bookId);
      setEditsModal(prev => ({ ...prev, edits: list, isLoading: false }));
    } catch (err) {
      console.error('Failed to load book edits:', err);
      setEditsModal(prev => ({ ...prev, isLoading: false }));
    }
  };

  const loadBooks = async () => {
    setIsLoadingBooks(true);
    try {
      const res = await api.get<{ books: Book[] }>('/admin/books');
      setBooks(res.books || []);
    } catch (err) {
      console.error('Failed to load books:', err);
    } finally {
      setIsLoadingBooks(false);
    }
  };

  const loadReaders = async () => {
    setIsLoadingReaders(true);
    try {
      const res = await api.get<{ readers: any[] }>('/admin/beta-readers');
      setReaders(res.readers || []);
    } catch (err) {
      console.error('Failed to load readers:', err);
    } finally {
      setIsLoadingReaders(false);
    }
  };

  const loadLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const res = await api.get<{ logs: ActivityLog[] }>('/admin/logs');
      setLogs(res.logs || []);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'books') loadBooks();
    if (activeTab === 'readers') loadReaders();
    if (activeTab === 'logs') loadLogs();
  }, [activeTab]);

  const handleDeleteBook = async (bookId: string, title: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa tác phẩm "${title}"? Mọi chương và tiến độ liên quan sẽ bị xóa vĩnh viễn.`)) {
      return;
    }
    try {
      await api.delete(`/admin/books/${bookId}`);
      loadBooks();
    } catch (err: any) {
      alert(err?.message || 'Không thể xóa truyện.');
    }
  };

  const handleToggleReaderStatus = async (readerId: string, currentStatus: boolean, username: string) => {
    const nextStatus = !currentStatus;
    const actionName = nextStatus ? 'mở khóa' : 'vô hiệu hóa';
    if (!window.confirm(`Bạn có chắc chắn muốn ${actionName} tài khoản @${username}?`)) {
      return;
    }
    try {
      await api.patch(`/admin/beta-readers/${readerId}/status`, { isActive: nextStatus });
      loadReaders();
    } catch (err: any) {
      alert(err?.message || 'Không thể cập nhật trạng thái người dùng.');
    }
  };

  const handleRevokeAssignment = async (bookId: string, userId: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn hủy phân công này?')) return;
    try {
      await api.delete(`/admin/books/${bookId}/assign/${userId}`);
      loadBooks();
    } catch (err: any) {
      alert(err?.message || 'Lỗi khi hủy phân công.');
    }
  };

  // Filtered books
  const filteredBooks = useMemo(() => {
    return books.filter(b => {
      const matchSearch = !searchQuery.trim() || 
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        b.author.toLowerCase().includes(searchQuery.toLowerCase());
      
      const hasAssignments = b.assignments && b.assignments.length > 0;
      const isCompleted = b.status === 'BETA_COMPLETE';

      if (!matchSearch) return false;
      if (statusFilter === 'assigned') return hasAssignments && !isCompleted;
      if (statusFilter === 'unassigned') return !hasAssignments;
      if (statusFilter === 'completed') return isCompleted;
      return true;
    });
  }, [books, searchQuery, statusFilter]);

  // Overall Statistics for Reading & Editorial Progress
  const stats = useMemo(() => {
    const totalBooks = books.length;
    let totalAssignments = 0;
    let completedAssignments = 0;
    let totalProgressSum = 0;

    books.forEach(b => {
      if (b.assignments) {
        totalAssignments += b.assignments.length;
        b.assignments.forEach(a => {
          totalProgressSum += a.overallPercentage || 0;
          if (a.completedChaptersCount === b.totalChapters && b.totalChapters > 0) {
            completedAssignments++;
          }
        });
      }
    });

    const avgProgress = totalAssignments > 0 ? Math.round(totalProgressSum / totalAssignments) : 0;
    const inBetaCount = books.filter(b => b.assignments && b.assignments.length > 0).length;

    return { totalBooks, totalAssignments, avgProgress, inBetaCount, completedAssignments };
  }, [books]);

  return (
    <div className="min-h-screen app-bg text-ink-900 flex flex-col font-sans">
      {accountOpen && <AdminAccountModal onClose={() => setAccountOpen(false)} />}
      {/* Top Studio Navbar */}
      <header className="bg-white/90 backdrop-blur-md border-b border-ink-100/80 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <BrandLogo
            badge="Admin"
            badgeVariant="admin"
            subtitle="Cổng Quản trị & Phân công Beta Reader"
          />

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-semibold text-ink-900">{user?.displayName}</span>
              <span className="text-[10px] text-ink-400 font-mono">@{user?.username} · Ban Quản Trị</span>
            </div>
            <button onClick={() => setAccountOpen(true)} className="px-3 py-2 text-xs rounded-xl border border-ink-200 hover:bg-ink-50">Tài khoản Admin</button>
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

      {/* Main Studio Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 flex-1 w-full space-y-6">
        
        {/* Editorial Desk / Reading Stats Banner ("Cảm giác chăm chỉ hơn") */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white rounded-2xl p-4 border border-ink-100 shadow-2xs hover:shadow-soft hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider block">
                Kho bản thảo
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold font-serif text-ink-950">{stats.totalBooks}</span>
                <span className="text-[11px] text-ink-500">tác phẩm</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-ink-100 shadow-2xs hover:shadow-soft hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider block">
                Đang đọc duyệt
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold font-serif text-purple-900">{stats.inBetaCount}</span>
                <span className="text-[11px] text-ink-500">truyện</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-ink-100 shadow-2xs hover:shadow-soft hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider block">
                Lượt phân công
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold font-serif text-blue-950">{stats.totalAssignments}</span>
                <span className="text-[11px] text-ink-500">lượt đọc</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-ink-100 shadow-2xs hover:shadow-soft hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider block">
                Tiến độ trung bình
              </span>
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-xl font-bold font-serif text-emerald-950">{stats.avgProgress}%</span>
                <span className="text-[10px] text-emerald-700 font-medium">
                  {stats.completedAssignments} lượt xong
                </span>
              </div>
              <div className="w-full h-1.5 bg-emerald-100 rounded-full mt-1 overflow-hidden">
                <div 
                  className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                  style={{ width: `${stats.avgProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Primary Navigation Tabs */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-ink-200/60 pb-3">
          <div className="flex items-center gap-1.5 bg-ink-100/60 p-1 rounded-2xl self-start">
            <button
              onClick={() => setActiveTab('books')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                activeTab === 'books'
                  ? 'bg-white text-ink-950 shadow-xs'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <BookOpen className="w-4 h-4 text-purple-700" />
              <span>Tủ bản thảo ({books.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('readers')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                activeTab === 'readers'
                  ? 'bg-white text-ink-950 shadow-xs'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <Users className="w-4 h-4 text-blue-700" />
              <span>Đội ngũ Beta Readers ({readers.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                activeTab === 'logs'
                  ? 'bg-white text-ink-950 shadow-xs'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <History className="w-4 h-4 text-ink-500" />
              <span>Nhật ký</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'books' && (
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-900 hover:bg-purple-950 text-white text-xs font-semibold shadow-xs transition transform hover:scale-[1.01] active:scale-[0.99]"
              >
                <Plus className="w-4 h-4" />
                <span>Thêm bản thảo mới</span>
              </button>
            )}

            {activeTab === 'readers' && (
              <button
                onClick={() => setIsCreateReaderOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-900 hover:bg-purple-950 text-white text-xs font-semibold shadow-xs transition"
              >
                <UserPlus className="w-4 h-4" />
                <span>Cấp tài khoản Beta Reader</span>
              </button>
            )}
          </div>
        </div>

        {/* TAB 1: BOOKS (TỦ BẢN THẢO) */}
        {activeTab === 'books' && (
          <div className="space-y-4">
            {/* Search & Quick Filter Bar */}
            <div className="bg-white rounded-2xl p-3 border border-ink-100 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo tên tác phẩm, tác giả..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-ink-200 text-xs bg-ink-50/50 text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-purple-600 focus:bg-white transition"
                />
              </div>

              {/* Status Filter Chips & View Mode */}
              <div className="flex items-center justify-between w-full md:w-auto gap-3">
                <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      statusFilter === 'all'
                        ? 'bg-purple-100 text-purple-900'
                        : 'text-ink-600 hover:bg-ink-100'
                    }`}
                  >
                    Tất cả ({books.length})
                  </button>
                  <button
                    onClick={() => setStatusFilter('assigned')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      statusFilter === 'assigned'
                        ? 'bg-purple-100 text-purple-900'
                        : 'text-ink-600 hover:bg-ink-100'
                    }`}
                  >
                    Đang duyệt ({stats.inBetaCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter('unassigned')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      statusFilter === 'unassigned'
                        ? 'bg-purple-100 text-purple-900'
                        : 'text-ink-600 hover:bg-ink-100'
                    }`}
                  >
                    Chưa giao ({stats.totalBooks - stats.inBetaCount})
                  </button>
                </div>

                <div className="h-4 w-px bg-ink-200 hidden md:block" />

                {/* View Layout Toggle */}
                <div className="flex items-center bg-ink-100 p-0.5 rounded-xl text-ink-600">
                  <button
                    onClick={() => setViewLayout('grid')}
                    className={`p-1.5 rounded-lg transition ${viewLayout === 'grid' ? 'bg-white text-ink-950 shadow-2xs' : 'hover:text-ink-900'}`}
                    title="Kệ sách dạng lưới"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewLayout('table')}
                    className={`p-1.5 rounded-lg transition ${viewLayout === 'table' ? 'bg-white text-ink-950 shadow-2xs' : 'hover:text-ink-900'}`}
                    title="Danh sách bảng gọn"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Book Catalog */}
            {isLoadingBooks ? (
              <div className="py-24 flex flex-col items-center justify-center gap-3 text-ink-400">
                <Loader2 className="w-8 h-8 animate-spin text-purple-800" />
                <p className="text-xs font-medium">Đang tải tủ sách bản thảo...</p>
              </div>
            ) : filteredBooks.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-ink-100 space-y-4 shadow-2xs">
                <div className="w-14 h-14 rounded-3xl bg-purple-50 text-purple-700 flex items-center justify-center mx-auto">
                  <BookOpen className="w-7 h-7" />
                </div>
                <h3 className="font-serif font-bold text-base text-ink-900">
                  {books.length === 0 ? 'Chưa có tác phẩm nào trong kho' : 'Không tìm thấy tác phẩm phù hợp'}
                </h3>
                <p className="text-xs text-ink-500 max-w-sm mx-auto leading-relaxed">
                  {books.length === 0 
                    ? 'Hãy tải lên tệp TXT, EPUB hoặc DOCX để hệ thống tự động trích xuất chương và phân công cho các Beta Readers.'
                    : 'Thử thay đổi từ khóa tìm kiếm hoặc chuyển bộ lọc về "Tất cả".'}
                </p>
                {books.length === 0 && (
                  <button
                    onClick={() => setIsUploadModalOpen(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-900 hover:bg-purple-950 text-white text-xs font-semibold shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tải lên truyện đầu tiên</span>
                  </button>
                )}
              </div>
            ) : viewLayout === 'grid' ? (
              /* GRID VIEW: TIDY BOOK CARDS (NO AWKWARD GAPS!) */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
                {filteredBooks.map((b) => (
                  <div
                    key={b.id}
                    className="bg-white rounded-3xl p-5 border border-ink-100/80 shadow-2xs hover:shadow-soft hover:-translate-y-0.5 hover:border-purple-200 transition-all duration-200 flex flex-col gap-4 group"
                  >
                    {/* Top Book Header */}
                    <div className="flex gap-4 items-start">
                      <BookCover
                        title={b.title}
                        author={b.author}
                        coverUrl={b.coverUrl}
                        coverColor={b.coverColor}
                        format={b.fileFormat}
                        size="sm"
                      />

                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <BookStatusBadge status={b.status} />
                          <FormatBadge format={b.fileFormat} />
                        </div>

                        <h4 className="font-serif font-bold text-sm text-ink-950 line-clamp-2 leading-snug group-hover:text-purple-900 transition">
                          {b.title}
                        </h4>

                        <p className="text-xs text-ink-500 line-clamp-1 italic font-serif">
                          {b.author}
                        </p>

                        <div className="text-[11px] text-ink-400 font-mono pt-0.5">
                          <span>{b.totalChapters} chương</span>
                          <span> · </span>
                          <span>{b.wordCount.toLocaleString('vi-VN')} chữ</span>
                        </div>
                      </div>
                    </div>

                    {/* Reader Cohort & Progress Section */}
                    <div className="pt-3 border-t border-ink-100 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-ink-400 uppercase tracking-wider text-[10px]">
                          Ban đọc duyệt ({b.assignments?.length || 0})
                        </span>
                        {b.assignments && b.assignments.length > 0 && (
                          <span className="text-purple-800 font-mono text-[10px] font-semibold">
                            {b.assignments.length} độc giả
                          </span>
                        )}
                      </div>

                      {b.assignments && b.assignments.length > 0 ? (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                          {b.assignments.map((a) => {
                            const isDone = a.completedChaptersCount === b.totalChapters && b.totalChapters > 0;
                            const initials = (a.displayName || a.username || 'BR').slice(0, 2).toUpperCase();

                            return (
                              <div 
                                key={a.id} 
                                className="p-2.5 rounded-2xl bg-[#FAF8F5] border border-ink-100/70 hover:border-purple-200 transition flex flex-col gap-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-5 h-5 rounded-full bg-purple-200 text-purple-900 text-[9px] font-bold flex items-center justify-center shrink-0">
                                      {initials}
                                    </div>
                                    <span className="text-xs font-semibold text-ink-900 truncate">
                                      {a.displayName}
                                    </span>
                                    <span className="text-[10px] text-ink-400 font-mono truncate hidden sm:inline">
                                      (@{a.username})
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {isDone ? (
                                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                                        <CheckCircle2 className="w-3 h-3" />
                                        <span>Đã xong</span>
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-mono text-ink-500">
                                        Chương {a.currentChapterIndex || 1}
                                      </span>
                                    )}

                                    <button
                                      onClick={() => handleRevokeAssignment(b.id, a.betaUserId)}
                                      className="p-1 text-ink-300 hover:text-rose-600 rounded-md transition"
                                      title="Hủy phân công người này"
                                    >
                                      <UserX className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Mini Progress bar */}
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between text-[10px] font-mono text-ink-500">
                                    <span>{a.completedChaptersCount || 0}/{b.totalChapters} chương</span>
                                    <span className="font-semibold text-purple-900">{Math.round(a.overallPercentage || 0)}%</span>
                                  </div>
                                  <div className="w-full h-1 bg-ink-200/50 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        isDone ? 'bg-emerald-600' : 'bg-purple-600'
                                      }`}
                                      style={{ width: `${Math.min(100, Math.max(0, a.overallPercentage || 0))}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <button
                          onClick={() => setAssignModal({
                            isOpen: true,
                            bookId: b.id,
                            bookTitle: b.title,
                            currentAssignedUserId: b.assignedTo?.id,
                          })}
                          className="w-full p-3 rounded-2xl border-2 border-dashed border-ink-200 hover:border-purple-300 bg-white hover:bg-purple-50/30 text-ink-400 hover:text-purple-800 text-xs font-medium text-center transition flex items-center justify-center gap-1.5"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>Chưa có ai duyệt · Nhấn để phân công</span>
                        </button>
                      )}
                    </div>

                    {/* Card Action Bar */}
                    <div className="pt-2 border-t border-ink-100 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => navigate(`/admin/books/${b.id}/review`)}
                          className="px-3.5 py-1.5 text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white rounded-xl shadow-xs transition flex items-center gap-1.5"
                          title="Mở phòng duyệt bản thảo (Review Workspace)"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                          <span>Duyệt</span>
                        </button>

                        <button
                          onClick={() => setAssignModal({
                            isOpen: true,
                            bookId: b.id,
                            bookTitle: b.title,
                            currentAssignedUserId: b.assignedTo?.id,
                          })}
                          className="px-3 py-1.5 text-xs font-semibold bg-purple-50 text-purple-900 hover:bg-purple-100 rounded-xl transition"
                        >
                          {b.assignments && b.assignments.length > 0 ? '+ Giao thêm' : 'Giao truyện'}
                        </button>

                        <button
                          onClick={() => handleOpenEditsModal(b.id, b.title)}
                          className="px-3 py-1.5 text-xs font-semibold bg-ink-100 text-ink-800 hover:bg-ink-200 rounded-xl transition flex items-center gap-1"
                          title="Xem tất cả đề xuất sửa đổi của Beta Readers"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-purple-700" />
                          <span>Xem Edits</span>
                        </button>
                      </div>

                      <button
                        onClick={() => handleDeleteBook(b.id, b.title)}
                        className="p-2 text-ink-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
                        title="Xóa bản thảo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* TABLE VIEW: ULTRA-TIDY COMPACT LIST */
              <div className="bg-white rounded-3xl border border-ink-100 shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FAF8F5] border-b border-ink-100 text-ink-400 uppercase font-mono text-[10px] tracking-wider">
                      <tr>
                        <th className="py-3 px-4">Tác phẩm</th>
                        <th className="py-3 px-4">Định dạng</th>
                        <th className="py-3 px-4">Chương / Chữ</th>
                        <th className="py-3 px-4">Beta Readers</th>
                        <th className="py-3 px-4">Trạng thái</th>
                        <th className="py-3 px-4 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100/60 font-sans">
                      {filteredBooks.map((b) => (
                        <tr key={b.id} className="hover:bg-purple-50/20 transition">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <BookCover
                                title={b.title}
                                author={b.author}
                                coverUrl={b.coverUrl}
                                coverColor={b.coverColor}
                                format={b.fileFormat}
                                size="xs"
                              />
                              <div>
                                <h5 className="font-serif font-bold text-xs text-ink-950 line-clamp-1">{b.title}</h5>
                                <p className="text-[11px] text-ink-500 italic">{b.author}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <FormatBadge format={b.fileFormat} />
                          </td>
                          <td className="py-3 px-4 font-mono text-ink-600">
                            {b.totalChapters} ch. · {b.wordCount.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-3 px-4">
                            {b.assignments && b.assignments.length > 0 ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {b.assignments.map(a => (
                                  <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-900 text-[10px] font-semibold border border-purple-100">
                                    <span>{a.displayName}</span>
                                    <span className="font-mono text-purple-600">({Math.round(a.overallPercentage || 0)}%)</span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-ink-400 italic text-[11px]">Chưa giao</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <BookStatusBadge status={b.status} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => navigate(`/admin/books/${b.id}/review`)}
                                className="px-2.5 py-1 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-[11px] font-bold transition flex items-center gap-1 shadow-2xs"
                                title="Duyệt bản thảo"
                              >
                                <Sparkles className="w-3 h-3 text-purple-200" />
                                <span>Duyệt</span>
                              </button>
                              <button
                                onClick={() => handleOpenEditsModal(b.id, b.title)}
                                className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-800 hover:bg-purple-100 text-[11px] font-semibold transition"
                              >
                                Edits
                              </button>
                              <button
                                onClick={() => setAssignModal({ isOpen: true, bookId: b.id, bookTitle: b.title })}
                                className="px-2.5 py-1 rounded-lg bg-ink-100 hover:bg-ink-200 text-ink-700 text-[11px] font-semibold transition"
                              >
                                Giao
                              </button>
                              <button
                                onClick={() => handleDeleteBook(b.id, b.title)}
                                className="p-1 text-ink-400 hover:text-rose-600 rounded-md transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: BETA READERS */}
        {activeTab === 'readers' && (
          <div className="bg-white rounded-3xl border border-ink-100 shadow-2xs overflow-hidden">
            <div className="px-6 py-4 border-b border-ink-100 flex items-center justify-between">
              <div>
                <h3 className="font-serif font-bold text-base text-ink-950">Danh sách tài khoản Beta Reader</h3>
                <p className="text-xs text-ink-500">Quản lý các độc giả duyệt bản thảo độc quyền</p>
              </div>
              <button
                onClick={loadReaders}
                className="px-3 py-1.5 rounded-xl border border-ink-200 text-ink-600 hover:bg-ink-50 text-xs font-semibold"
              >
                Làm mới
              </button>
            </div>

            {isLoadingReaders ? (
              <div className="py-20 flex flex-col items-center justify-center gap-2 text-ink-400">
                <Loader2 className="w-6 h-6 animate-spin text-purple-700" />
                <span className="text-xs">Đang tải danh sách tài khoản...</span>
              </div>
            ) : readers.length === 0 ? (
              <div className="p-12 text-center text-ink-500 text-xs space-y-3">
                <p>Chưa có tài khoản Beta Reader nào được cấp.</p>
                <button
                  onClick={() => setIsCreateReaderOpen(true)}
                  className="px-4 py-2 rounded-xl bg-purple-900 text-white text-xs font-semibold"
                >
                  Cấp tài khoản đầu tiên
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF8F5] border-b border-ink-100 text-ink-400 uppercase font-mono text-[10px] tracking-wider">
                    <tr>
                      <th className="py-3 px-6">Tên hiển thị & Username</th>
                      <th className="py-3 px-6">Vai trò</th>
                      <th className="py-3 px-6">Trạng thái</th>
                      <th className="py-3 px-6">Ngày cấp</th>
                      <th className="py-3 px-6 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100/60">
                    {readers.map((r) => (
                      <tr key={r.id} className="hover:bg-purple-50/10 transition">
                        <td className="py-3 px-6">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-900 font-bold flex items-center justify-center text-[10px]">
                              {(r.displayName || r.username).slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-semibold text-ink-950 block">{r.displayName}</span>
                              <span className="text-[11px] font-mono text-ink-400">@{r.username}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-6">
                          <RoleBadge role={r.role} />
                        </td>
                        <td className="py-3 px-6">
                          <ActiveBadge isActive={Boolean(r.isActive)} />
                        </td>
                        <td className="py-3 px-6 font-mono text-ink-400 text-[11px]">
                          {new Date(r.createdAt).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="py-3 px-6 text-right">
                          <button
                            onClick={() => handleToggleReaderStatus(r.id, Boolean(r.isActive), r.username)}
                            className={`px-3 py-1 rounded-xl text-xs font-semibold transition ${
                              r.isActive
                                ? 'text-rose-600 hover:bg-rose-50 border border-rose-200'
                                : 'text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
                            }`}
                          >
                            {r.isActive ? 'Khóa tài khoản' : 'Mở khóa'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: AUDIT LOGS */}
        {activeTab === 'logs' && (
          <div className="bg-white rounded-3xl border border-ink-100 shadow-2xs overflow-hidden">
            <div className="px-6 py-4 border-b border-ink-100 flex items-center justify-between">
              <div>
                <h3 className="font-serif font-bold text-base text-ink-950">Nhật ký hoạt động bảo mật</h3>
                <p className="text-xs text-ink-500">Toàn bộ thao tác phân công, đăng nhập và chỉnh sửa được lưu vết</p>
              </div>
              <button
                onClick={loadLogs}
                className="px-3 py-1.5 rounded-xl border border-ink-200 text-ink-600 hover:bg-ink-50 text-xs font-semibold"
              >
                Làm mới
              </button>
            </div>

            {isLoadingLogs ? (
              <div className="py-20 flex flex-col items-center justify-center gap-2 text-ink-400">
                <Loader2 className="w-6 h-6 animate-spin text-purple-700" />
                <span className="text-xs">Đang tải nhật ký...</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="p-12 text-center text-ink-500 text-xs">
                Chưa có nhật ký hoạt động nào.
              </div>
            ) : (
              <div className="divide-y divide-ink-100/60 max-h-[500px] overflow-y-auto">
                {logs.map((log) => (
                  <div key={log.id} className="p-4 flex items-center justify-between gap-4 text-xs hover:bg-ink-50/50 transition">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-purple-900 font-mono text-[11px] bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
                          {log.action}
                        </span>
                        <span className="font-semibold text-ink-800">{log.userDisplayName || log.userName || 'System'}</span>
                      </div>
                      {log.details && (
                        <p className="text-ink-500 font-mono text-[11px] line-clamp-1">{log.details}</p>
                      )}
                    </div>
                    <span className="text-[11px] text-ink-400 shrink-0 font-mono">
                      {new Date(log.createdAt).toLocaleString('vi-VN')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      <BookUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={() => loadBooks()}
      />

      <AssignModal
        isOpen={assignModal.isOpen}
        bookId={assignModal.bookId}
        bookTitle={assignModal.bookTitle}
        currentAssignedUserId={assignModal.currentAssignedUserId}
        onClose={() => setAssignModal({ isOpen: false, bookId: null, bookTitle: '' })}
        onSuccess={() => loadBooks()}
      />

      <CreateReaderModal
        isOpen={isCreateReaderOpen}
        onClose={() => setIsCreateReaderOpen(false)}
        onSuccess={() => loadReaders()}
      />

      {/* Admin Edits Inspector Modal */}
      {editsModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setEditsModal(prev => ({ ...prev, isOpen: false }))}
        >
          <div
            className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-ink-100 p-6 space-y-4 animate-in zoom-in-95 duration-150 text-ink-900 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-ink-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl bg-purple-50 text-purple-800 flex items-center justify-center">
                  <Edit3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-serif font-bold text-base text-ink-950">
                    Bản chỉnh sửa Beta — {editsModal.bookTitle}
                  </h3>
                  <p className="text-xs text-ink-500">
                    Tổng cộng {editsModal.edits.length} đề xuất sửa từ các Beta Readers
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditsModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 rounded-full text-ink-400 hover:text-ink-700 hover:bg-ink-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-1">
              {editsModal.isLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-ink-400">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-800" />
                  <span className="text-xs">Đang tải danh sách chỉnh sửa...</span>
                </div>
              ) : editsModal.edits.length === 0 ? (
                <div className="text-center py-16 text-xs text-ink-400">
                  Chưa có chỉnh sửa nào từ các Beta Readers cho tác phẩm này.
                </div>
              ) : (
                editsModal.edits.map((edit) => (
                  <div key={edit.id} className="p-4 rounded-2xl border border-ink-100 bg-[#FAF8F5] space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink-900">
                          {edit.userDisplayName || edit.userName || 'Beta Reader'}
                        </span>
                        <span className="text-ink-400 font-mono text-[11px]">
                          Chương {edit.chapterIndex} · Đoạn {edit.paragraphIndex + 1}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-200">
                          {ERROR_TYPE_LABELS[edit.errorType] || edit.errorType}
                        </span>
                        <span className="text-[10px] text-ink-400 font-mono">
                          v{edit.version}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-serif">
                      <div className="p-2.5 rounded-xl bg-rose-50/60 border border-rose-200/60 text-rose-950">
                        <span className="font-sans text-[10px] font-bold text-rose-700 block mb-0.5">Bản gốc:</span>
                        - {edit.originalText}
                      </div>
                      <div className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-200/60 text-emerald-950 font-medium">
                        <span className="font-sans text-[10px] font-bold text-emerald-700 block mb-0.5">Đã sửa:</span>
                        + {edit.currentText}
                      </div>
                    </div>

                    {edit.reason && (
                      <p className="text-[11px] text-ink-600 italic font-serif">
                        Lý do: "{edit.reason}"
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-ink-400 pt-1 border-t border-ink-100/60 font-mono">
                      <span>Trạng thái: <strong className={edit.status === 'ACTIVE' ? 'text-emerald-600' : 'text-rose-600'}>{edit.status}</strong></span>
                      <span>{new Date(edit.updatedAt).toLocaleString('vi-VN')}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-ink-100 flex justify-end">
              <button
                onClick={() => setEditsModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-ink-100 hover:bg-ink-200 text-ink-700 transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

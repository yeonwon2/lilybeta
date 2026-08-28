import { ExportApproved } from '../../../exports/ExportApproved';
import React, { useState, useEffect, useMemo } from 'react';
import { api, ApiError } from '../../../services/api';
import { BrandLogo } from '../../../components/common/BrandLogo';
import { ErrorType, ERROR_TYPE_OPTIONS, ERROR_TYPE_LABELS } from '../../../beta-edit/editTypes';
import {
  DerivedReviewStatus,
  ChapterReviewDetailResponse,
} from '../../../beta-review/reviewTypes';
import { ReviewChapterContent } from './ReviewChapterContent';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Filter,
  Check,
  X,
  MessageSquare,
  AlertTriangle,
  History,
  Layers,
  Sparkles,
  BookOpen,
  Send,
  Loader2,
  FileCheck,
} from 'lucide-react';

interface AdminReviewWorkspaceProps {
  bookId: string;
  assignmentId?: string;
  initialChapterIndex?: number;
  onBack: () => void;
}

export const AdminReviewWorkspace: React.FC<AdminReviewWorkspaceProps> = ({
  bookId,
  assignmentId: initialAssignmentId,
  initialChapterIndex = 1,
  onBack,
}) => {
  const [bookOverview, setBookOverview] = useState<any>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>(initialAssignmentId || '');
  const [currentChapterIndex, setCurrentChapterIndex] = useState<number>(initialChapterIndex);

  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  const [chapterData, setChapterData] = useState<ChapterReviewDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Active view layer
  const [contentLayer, setContentLayer] = useState<'working' | 'approved' | 'original'>('working');

  // Filters
  const [statusFilter, setStatusFilter] = useState<'ALL' | DerivedReviewStatus>('ALL');
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>('ALL');

  // Selected Edit for Review Panel
  const [selectedEdit, setSelectedEdit] = useState<any | null>(null);
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false);
  const [reviewAction, setReviewAction] = useState<'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED' | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Approval Modal
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // 1. Fetch Book Overview (Assignments and Chapter List)
  const fetchOverview = async () => {
    try {
      setIsLoadingOverview(true);
      setLoadError(null);
      const res = await api.get<any>(`/admin/books/${bookId}/review`);
      setBookOverview(res);

      // Auto-select assignment if not set
      if (!selectedAssignmentId && res.assignments && res.assignments.length > 0) {
        setSelectedAssignmentId(res.assignments[0].assignmentId);
      }
    } catch (err: any) {
      setLoadError(err.message || 'Không thể tải tổng quan biên tập');
    } finally {
      setIsLoadingOverview(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, [bookId]);

  // 2. Fetch Chapter Detail
  const fetchChapterDetail = async (assignmentId: string, chapterIndex: number) => {
    if (!assignmentId || !chapterIndex) return;
    try {
      setIsLoadingChapter(true);
      setLoadError(null);
      const res = await api.get<ChapterReviewDetailResponse>(
        `/admin/books/${bookId}/assignments/${assignmentId}/chapters/${chapterIndex}/review`
      );
      setChapterData(res);

      // If an edit was previously selected, refresh its reference
      if (selectedEdit) {
        const refreshed = res.edits.find((e: any) => e.id === selectedEdit.id);
        setSelectedEdit(refreshed || null);
      }
    } catch (err: any) {
      setLoadError(err.message || 'Không thể tải chi tiết chương');
    } finally {
      setIsLoadingChapter(false);
    }
  };

  useEffect(() => {
    if (selectedAssignmentId) {
      fetchChapterDetail(selectedAssignmentId, currentChapterIndex);
    }
  }, [selectedAssignmentId, currentChapterIndex]);

  // Current active assignment summary
  const currentAssignment = useMemo(() => {
    if (!bookOverview || !selectedAssignmentId) return null;
    return bookOverview.assignments.find((a: any) => a.assignmentId === selectedAssignmentId);
  }, [bookOverview, selectedAssignmentId]);

  // Filtered edits list
  const filteredEdits = useMemo(() => {
    if (!chapterData) return [];
    return chapterData.edits.filter((e) => {
      if (statusFilter !== 'ALL' && e.derivedReviewStatus !== statusFilter) return false;
      if (errorTypeFilter !== 'ALL' && e.errorType !== errorTypeFilter) return false;
      return true;
    });
  }, [chapterData, statusFilter, errorTypeFilter]);

  // Review status counts for current chapter
  const chapterMetrics = useMemo(() => {
    if (!chapterData) return { total: 0, pending: 0, accepted: 0, changes: 0, rejected: 0 };
    let pending = 0;
    let accepted = 0;
    let changes = 0;
    let rejected = 0;

    for (const e of chapterData.edits) {
      if (e.derivedReviewStatus === 'ACCEPTED') accepted++;
      else if (e.derivedReviewStatus === 'CHANGES_REQUESTED') changes++;
      else if (e.derivedReviewStatus === 'REJECTED') rejected++;
      else pending++;
    }

    return {
      total: chapterData.edits.length,
      pending,
      accepted,
      changes,
      rejected,
    };
  }, [chapterData]);

  // Handle Review Submission (Accept, Reject, Request Changes)
  const handleSubmitReview = async (decision: 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED') => {
    if (!selectedEdit) return;

    if (decision === 'CHANGES_REQUESTED' && !reviewComment.trim()) {
      setReviewError('Vui lòng nhập lý do hoặc yêu cầu cụ thể khi yêu cầu sửa lại');
      return;
    }

    setIsReviewSubmitting(true);
    setReviewError(null);

    try {
      await api.post(`/admin/edits/${selectedEdit.id}/reviews`, {
        decision,
        comment: reviewComment.trim() || undefined,
        expectedRevisionNumber: selectedEdit.version,
        expectedEditVersion: selectedEdit.version,
      });

      // Clear action input
      setReviewAction(null);
      setReviewComment('');

      // Refresh chapter details and overview
      await fetchChapterDetail(selectedAssignmentId, currentChapterIndex);
      fetchOverview();
    } catch (err: any) {
      if (err.code === 'REVIEW_STALE') {
        setReviewError('Beta Reader vừa cập nhật phiên bản mới của đề xuất này. Vui lòng xem bản mới.');
        await fetchChapterDetail(selectedAssignmentId, currentChapterIndex);
      } else {
        setReviewError(err.message || 'Không thể lưu đánh giá');
      }
    } finally {
      setIsReviewSubmitting(false);
    }
  };

  // Handle Chapter Approval
  const handleApproveChapter = async () => {
    if (!chapterData) return;
    setIsApproving(true);
    setApproveError(null);

    try {
      await api.post(
        `/admin/books/${bookId}/assignments/${selectedAssignmentId}/chapters/${currentChapterIndex}/approve`
      );
      setIsApproveModalOpen(false);
      await fetchChapterDetail(selectedAssignmentId, currentChapterIndex);
      fetchOverview();
    } catch (err: any) {
      setApproveError(err.message || 'Không thể phê duyệt chương');
    } finally {
      setIsApproving(false);
    }
  };

  // Handle Reopen Chapter
  const handleReopenChapter = async () => {
    if (!confirm('Bạn có chắc muốn mở lại chương này để rà soát biên tập?')) return;
    try {
      await api.post(
        `/admin/books/${bookId}/assignments/${selectedAssignmentId}/chapters/${currentChapterIndex}/reopen`
      );
      await fetchChapterDetail(selectedAssignmentId, currentChapterIndex);
      fetchOverview();
    } catch (err: any) {
      alert(err.message || 'Không thể mở lại chương');
    }
  };

  // Handle Resolve Note
  const handleResolveNote = async (noteId: string) => {
    try {
      await api.patch(`/admin/notes/${noteId}/resolve`);
      await fetchChapterDetail(selectedAssignmentId, currentChapterIndex);
    } catch (err: any) {
      alert(err.message || 'Không thể xử lý ghi chú');
    }
  };

  if (isLoadingOverview && !bookOverview) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF8F5]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-lily-600 animate-spin" />
          <p className="text-sm font-medium text-ink-600">Đang tải không gian duyệt bản thảo...</p>
        </div>
      </div>
    );
  }

  const isChapterApproved = chapterData?.chapter.derivedStatus === 'APPROVED';

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-ink-900 flex flex-col antialiased">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-ink-100 px-4 py-3 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              className="p-2 -ml-2 rounded-xl text-ink-500 hover:text-ink-900 hover:bg-ink-100 transition"
              title="Quay lại Dashboard"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold text-ink-900 truncate">
                  {bookOverview?.book?.title || 'Duyệt Bản Thảo'}
                </h1>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                  Phòng Biên Tập
                </span>
              </div>
              <p className="text-xs text-ink-500 truncate">
                Độc giả: <span className="font-semibold text-ink-700">{currentAssignment?.betaDisplayName || 'Beta Reader'}</span>
                {' • '}
                Tổng {bookOverview?.book?.totalChapters || 1} chương
              </p>
            </div>
          </div>

          {/* Chapter Selector & Layer Switcher */}
          <div className="flex items-center gap-2">
            <ExportApproved key={`${bookId}:${selectedAssignmentId}`} bookId={bookId} assignmentId={selectedAssignmentId} readerName={currentAssignment?.betaDisplayName || "Beta Reader"} currentChapter={currentChapterIndex} />
            {/* Chapter Navigator */}
            <div className="flex items-center bg-ink-50 rounded-2xl border border-ink-200 p-1">
              <button
                disabled={currentChapterIndex <= 1}
                onClick={() => setCurrentChapterIndex((prev) => Math.max(1, prev - 1))}
                className="p-1 rounded-xl text-ink-600 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition"
                title="Chương trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <select
                value={currentChapterIndex}
                onChange={(e) => setCurrentChapterIndex(parseInt(e.target.value, 10))}
                className="bg-transparent text-xs font-bold text-ink-800 px-2 py-1 outline-hidden cursor-pointer"
              >
                {Array.from({ length: bookOverview?.book?.totalChapters || 1 }, (_, i) => i + 1).map((idx) => {
                  const chSummary = currentAssignment?.chapters?.find((c: any) => c.chapterIndex === idx);
                  let badge = '';
                  if (chSummary?.reviewStatus === 'APPROVED') badge = ' [Đã duyệt]';
                  else if (chSummary?.pendingEdits > 0) badge = ` (${chSummary.pendingEdits} chờ)`;
                  return (
                    <option key={idx} value={idx}>
                      Chương {idx} {badge}
                    </option>
                  );
                })}
              </select>
              <button
                disabled={currentChapterIndex >= (bookOverview?.book?.totalChapters || 1)}
                onClick={() => setCurrentChapterIndex((prev) => prev + 1)}
                className="p-1 rounded-xl text-ink-600 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition"
                title="Chương sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Approval Action */}
            {isChapterApproved ? (
              <button
                onClick={handleReopenChapter}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Mở lại rà soát</span>
              </button>
            ) : (
              <button
                onClick={() => setIsApproveModalOpen(true)}
                disabled={!chapterData || isLoadingChapter || !!loadError || chapterMetrics.pending > 0 || chapterMetrics.changes > 0}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-2xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs disabled:opacity-40 disabled:hover:bg-emerald-600 transition"
                title={
                  chapterMetrics.pending > 0 || chapterMetrics.changes > 0
                    ? `Cần duyệt hết ${chapterMetrics.pending + chapterMetrics.changes} đề xuất trước khi phê duyệt`
                    : 'Phê duyệt toàn bộ chương'
                }
              >
                <FileCheck className="w-3.5 h-3.5" />
                <span>Phê duyệt chương</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Layers Switcher */}
        <div className="max-w-7xl mx-auto mt-2.5 pt-2 border-t border-ink-100 flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center gap-1 bg-ink-100/60 p-1 rounded-2xl">
            <button
              onClick={() => setContentLayer('working')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                contentLayer === 'working'
                  ? 'bg-white text-purple-900 shadow-xs'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Working Version (Đề xuất)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 text-purple-800">
                {chapterMetrics.total}
              </span>
            </button>

            <button
              onClick={() => setContentLayer('approved')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                contentLayer === 'approved'
                  ? 'bg-white text-emerald-900 shadow-xs'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Approved Version (Đã duyệt)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800">
                {chapterMetrics.accepted}
              </span>
            </button>

            <button
              onClick={() => setContentLayer('original')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                contentLayer === 'original'
                  ? 'bg-white text-ink-900 shadow-xs'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-ink-500" />
              <span>Nguyên tác</span>
            </button>
          </div>

          {/* Chapter approval state badge */}
          <div className="flex items-center gap-2">
            {isChapterApproved ? (
              <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
                ĐÃ PHÊ DUYỆT
              </span>
            ) : chapterData?.chapter.derivedStatus === 'REOPENED' ? (
              <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                <AlertTriangle className="w-3.5 h-3.5" />
                ĐÃ MỞ LẠI RÀ SOÁT
              </span>
            ) : (
              <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-ink-100 text-ink-600 border border-ink-200">
                <Clock className="w-3.5 h-3.5" />
                ĐANG RÀ SOÁT
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="max-w-7xl mx-auto w-full px-4 py-4 sm:px-6 flex-1 flex flex-col lg:flex-row gap-6">
        {/* Left / Center: Reader Content Workspace */}
        <div className="flex-1 flex flex-col min-w-0 space-y-4">
          {/* Filter Bar (Only shown in Working Version layer) */}
          {contentLayer === 'working' && (
            <div className="bg-white rounded-3xl p-3 border border-ink-100 shadow-xs flex flex-wrap items-center justify-between gap-3">
              {/* Status Tabs */}
              <div className="flex items-center gap-1 overflow-x-auto text-xs">
                <button
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition ${
                    statusFilter === 'ALL'
                      ? 'bg-ink-900 text-white shadow-xs'
                      : 'text-ink-600 hover:bg-ink-100'
                  }`}
                >
                  Tất cả ({chapterMetrics.total})
                </button>
                <button
                  onClick={() => setStatusFilter('PENDING')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 ${
                    statusFilter === 'PENDING'
                      ? 'bg-purple-700 text-white shadow-xs'
                      : 'text-purple-700 hover:bg-purple-50'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  Chờ duyệt ({chapterMetrics.pending})
                </button>
                <button
                  onClick={() => setStatusFilter('ACCEPTED')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 ${
                    statusFilter === 'ACCEPTED'
                      ? 'bg-emerald-700 text-white shadow-xs'
                      : 'text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  <Check className="w-3 h-3" />
                  Đã duyệt ({chapterMetrics.accepted})
                </button>
                <button
                  onClick={() => setStatusFilter('CHANGES_REQUESTED')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 ${
                    statusFilter === 'CHANGES_REQUESTED'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-amber-700 hover:bg-amber-50'
                  }`}
                >
                  <AlertCircle className="w-3 h-3" />
                  Cần sửa ({chapterMetrics.changes})
                </button>
                <button
                  onClick={() => setStatusFilter('REJECTED')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 ${
                    statusFilter === 'REJECTED'
                      ? 'bg-rose-700 text-white shadow-xs'
                      : 'text-rose-700 hover:bg-rose-50'
                  }`}
                >
                  <X className="w-3 h-3" />
                  Từ chối ({chapterMetrics.rejected})
                </button>
              </div>

              {/* Error Type Filter */}
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-ink-400" />
                <select
                  value={errorTypeFilter}
                  onChange={(e) => setErrorTypeFilter(e.target.value)}
                  className="text-xs font-semibold bg-ink-50 border border-ink-200 rounded-xl px-2.5 py-1 text-ink-700 outline-hidden"
                >
                  <option value="ALL">Mọi loại lỗi</option>
                  {ERROR_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Conflict Warning Banner if Approved Overlap detected */}
          {contentLayer === 'approved' && chapterData?.approvedVersion.conflict && (
            <div className="p-4 rounded-3xl bg-rose-50 border border-rose-200 text-rose-950 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm">Xung đột chỉnh sửa được duyệt (APPROVED_EDIT_CONFLICT)</h4>
                <p className="text-xs mt-1 text-rose-800">
                  {chapterData.approvedVersion.conflict.message}
                </p>
                <p className="text-xs mt-1 font-semibold text-rose-900">
                  Vui lòng từ chối một trong hai đề xuất để khôi phục tính nhất quán của bản thảo.
                </p>
              </div>
            </div>
          )}

          {/* Reader Document Container */}
          <div className="bg-white rounded-3xl p-6 sm:p-10 border border-ink-100 shadow-xs min-h-[500px]">
            {isLoadingChapter ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <Loader2 className="w-8 h-8 text-lily-600 animate-spin" />
                <p className="text-xs font-medium text-ink-500">Đang hiển thị nội dung chương...</p>
              </div>
            ) : loadError ? (
              <div className="text-center py-16 text-rose-600 space-y-2">
                <AlertCircle className="w-8 h-8 mx-auto" />
                <p className="text-sm font-bold">{loadError}</p>
              </div>
            ) : (
              chapterData ? <ReviewChapterContent
                chapterData={chapterData}
                contentLayer={contentLayer}
                selectedEdit={selectedEdit}
                onSelectEdit={(edit) => {
                  setSelectedEdit(edit);
                  setReviewAction(null);
                  setReviewComment(edit.currentReview?.comment || '');
                  setReviewError(null);
                }}
              /> : <p className="text-center text-ink-500 py-16">Chưa có phân công đọc duyệt cho tác phẩm này.</p>
            )}
          </div>
        </div>

        {/* Right Sidebar / Bottom Sheet: Review Panel */}
        <div className="w-full lg:w-96 shrink-0 space-y-4">
          {selectedEdit ? (
            <div className="bg-white rounded-3xl p-5 border border-ink-100 shadow-xs space-y-4 sticky top-24">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-ink-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
                    {ERROR_TYPE_LABELS[selectedEdit.errorType as ErrorType] || selectedEdit.errorType}
                  </span>
                  <span className="text-xs font-mono text-ink-400">
                    v{selectedEdit.version}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedEdit(null)}
                  className="p-1 rounded-full text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Status Badge */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink-500">Trạng thái duyệt:</span>
                <span
                  className={`px-2.5 py-0.5 rounded-full font-bold ${
                    selectedEdit.derivedReviewStatus === 'ACCEPTED'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : selectedEdit.derivedReviewStatus === 'CHANGES_REQUESTED'
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : selectedEdit.derivedReviewStatus === 'REJECTED'
                      ? 'bg-rose-100 text-rose-800 border border-rose-300'
                      : 'bg-purple-100 text-purple-800 border border-purple-300'
                  }`}
                >
                  {selectedEdit.derivedReviewStatus === 'ACCEPTED'
                    ? 'ĐÃ DUYỆT'
                    : selectedEdit.derivedReviewStatus === 'CHANGES_REQUESTED'
                    ? 'YÊU CẦU SỬA'
                    : selectedEdit.derivedReviewStatus === 'REJECTED'
                    ? 'TỪ CHỐI'
                    : 'CHỜ DUYỆT'}
                </span>
              </div>

              {/* Diff View */}
              <div className="space-y-2">
                <div>
                  <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">
                    Bản gốc (Nguyên tác):
                  </span>
                  <div className="p-2.5 rounded-2xl bg-rose-50/70 border border-rose-200 text-xs font-serif text-rose-950">
                    - {selectedEdit.originalText}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">
                    Đề xuất của Beta:
                  </span>
                  <div className="p-2.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-xs font-serif text-emerald-950 font-medium">
                    + {selectedEdit.currentText}
                  </div>
                </div>

                {selectedEdit.reason && (
                  <div>
                    <span className="text-[10px] font-bold text-ink-400 uppercase tracking-wider block">
                      Ghi chú của Beta Reader:
                    </span>
                    <p className="text-xs text-ink-700 italic bg-ink-50 p-2.5 rounded-2xl border border-ink-100">
                      "{selectedEdit.reason}"
                    </p>
                  </div>
                )}
              </div>

              {/* Error Message */}
              {reviewError && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                  {reviewError}
                </div>
              )}

              {/* Review Actions */}
              <div className="pt-3 border-t border-ink-100 space-y-3">
                <span className="text-xs font-bold text-ink-700 block">Quyết định biên tập:</span>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleSubmitReview('ACCEPTED')}
                    disabled={isReviewSubmitting}
                    className={`py-2 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 ${
                      selectedEdit.derivedReviewStatus === 'ACCEPTED'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Duyệt</span>
                  </button>

                  <button
                    onClick={() => {
                      setReviewAction('CHANGES_REQUESTED');
                      setReviewComment(selectedEdit.currentReview?.comment || '');
                    }}
                    disabled={isReviewSubmitting}
                    className={`py-2 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 ${
                      selectedEdit.derivedReviewStatus === 'CHANGES_REQUESTED' || reviewAction === 'CHANGES_REQUESTED'
                        ? 'bg-amber-500 text-white shadow-xs'
                        : 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Cần sửa</span>
                  </button>

                  <button
                    onClick={() => handleSubmitReview('REJECTED')}
                    disabled={isReviewSubmitting}
                    className={`py-2 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 ${
                      selectedEdit.derivedReviewStatus === 'REJECTED'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'bg-rose-50 text-rose-800 border border-rose-300 hover:bg-rose-100'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Từ chối</span>
                  </button>
                </div>

                {/* Comment Box when Requesting Changes */}
                {reviewAction === 'CHANGES_REQUESTED' && (
                  <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-2 animate-in fade-in duration-150">
                    <label className="text-xs font-bold text-amber-950 block">
                      Yêu cầu Beta Reader chỉnh lại:
                    </label>
                    <textarea
                      rows={3}
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder="Nhập lý do hoặc hướng sửa cụ thể..."
                      className="w-full text-xs p-2.5 rounded-xl border border-amber-300 bg-white text-ink-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setReviewAction(null)}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold text-ink-600 hover:bg-amber-100"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSubmitReview('CHANGES_REQUESTED')}
                        disabled={isReviewSubmitting}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 shadow-xs flex items-center gap-1"
                      >
                        {isReviewSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        <span>Gửi yêu cầu</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Revision & Review History Timeline */}
              {selectedEdit.revisions && selectedEdit.revisions.length > 0 && (
                <div className="pt-3 border-t border-ink-100 space-y-2">
                  <span className="text-xs font-bold text-ink-700 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-ink-500" />
                    Lịch sử ({selectedEdit.revisions.length} phiên bản):
                  </span>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {selectedEdit.revisions.map((rev: any) => {
                      const revReview = selectedEdit.reviews?.find(
                        (r: any) => r.reviewedRevisionNumber === rev.revisionNumber
                      );
                      return (
                        <div
                          key={rev.id}
                          className="p-2.5 rounded-2xl bg-ink-50 text-xs border border-ink-100 space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-ink-800">
                              Phiên bản {rev.revisionNumber}
                            </span>
                            {revReview && (
                              <span
                                className={`px-2 py-0.2 rounded-full text-[10px] font-bold ${
                                  revReview.decision === 'ACCEPTED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : revReview.decision === 'CHANGES_REQUESTED'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {revReview.decision}
                              </span>
                            )}
                          </div>
                          <p className="font-serif text-ink-900 font-medium">"{rev.afterText}"</p>
                          {revReview?.comment && (
                            <p className="text-[11px] text-ink-600 italic">
                              Admin: "{revReview.comment}"
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Empty State / Notes Panel */
            <div className="bg-white rounded-3xl p-6 border border-ink-100 shadow-xs space-y-4">
              <div className="text-center py-6 space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-sm text-ink-800">Bảng Điều Khiển Biên Tập</h3>
                <p className="text-xs text-ink-500 leading-relaxed">
                  Nhấn vào bất kỳ cụm từ có đánh dấu màu trên bản thảo để xem chi tiết đối chiếu và phê duyệt.
                </p>
              </div>

              {/* Reader Notes Section */}
              {chapterData?.notes && chapterData.notes.length > 0 && (
                <div className="border-t border-ink-100 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ink-800 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
                      Ghi chú của Beta ({chapterData.notes.length})
                    </span>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {chapterData.notes.map((n: any) => (
                      <div
                        key={n.id}
                        className={`p-3 rounded-2xl text-xs border space-y-1.5 ${
                          n.status === 'RESOLVED'
                            ? 'bg-ink-50/60 border-ink-200 text-ink-500 line-through'
                            : 'bg-amber-50/70 border-amber-200 text-amber-950'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[10px] uppercase text-amber-800">
                            Đoạn {n.paragraphIndex + 1}
                          </span>
                          {n.status !== 'RESOLVED' && (
                            <button
                              onClick={() => handleResolveNote(n.id)}
                              className="text-[10px] font-bold text-emerald-700 hover:underline flex items-center gap-0.5"
                            >
                              <Check className="w-3 h-3" />
                              Đã xử lý
                            </button>
                          )}
                        </div>
                        {n.selectedText && (
                          <p className="font-serif text-ink-700 italic text-[11px]">
                            "{n.selectedText}"
                          </p>
                        )}
                        <p className="font-medium text-ink-900">{n.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chapter Approval Modal */}
      {isApproveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsApproveModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-ink-100 p-6 space-y-5 animate-in zoom-in-95 duration-150 text-ink-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-ink-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <FileCheck className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-base text-ink-900">
                  Phê Duyệt Chương {currentChapterIndex}
                </h3>
              </div>
              <button
                onClick={() => setIsApproveModalOpen(false)}
                className="p-1 rounded-full text-ink-400 hover:text-ink-700 hover:bg-ink-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-ink-600 leading-relaxed">
              Bạn đang chuẩn bị niêm phong bản thảo được duyệt cho Chương {currentChapterIndex}. Tất cả các chỉnh sửa được chấp nhận sẽ trở thành bản in chuẩn.
            </p>

            {/* Checklist summary */}
            <div className="p-4 rounded-2xl bg-ink-50 border border-ink-100 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Đề xuất được chấp nhận:</span>
                <span className="font-bold text-emerald-700">
                  {chapterMetrics.accepted} đề xuất
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Đề xuất bị từ chối:</span>
                <span className="font-bold text-rose-700">
                  {chapterMetrics.rejected} đề xuất
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Đề xuất còn chờ duyệt:</span>
                <span className={`font-bold ${chapterMetrics.pending > 0 ? 'text-amber-600' : 'text-ink-700'}`}>
                  {chapterMetrics.pending} đề xuất
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Đề xuất yêu cầu sửa lại:</span>
                <span className={`font-bold ${chapterMetrics.changes > 0 ? 'text-amber-600' : 'text-ink-700'}`}>
                  {chapterMetrics.changes} đề xuất
                </span>
              </div>
            </div>

            {approveError && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                {approveError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsApproveModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-ink-600 hover:bg-ink-100"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleApproveChapter}
                disabled={!chapterData || isLoadingChapter || !!loadError || isApproving || chapterMetrics.pending > 0 || chapterMetrics.changes > 0}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs disabled:opacity-40 flex items-center gap-1.5 transition"
              >
                {isApproving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Xác nhận phê duyệt chương</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import { Book, Chapter } from '../../types';
import { 
  NormalizedBook, 
  ReadingProgress, 
  ParsedBookDraft, 
  StorageEstimateInfo 
} from '../types';
import { BetaEdit, EditRevision, BetaNote, ErrorType } from '../../beta-edit/editTypes';
import { BookSource } from './BookSource';
import { api } from '../../services/api';
import { ChapterCache } from '../../cache/chapterCache';

export class BetaCloudBookSource implements BookSource {
  private static instance: BetaCloudBookSource | null = null;
  private currentUserId: string = 'anonymous';

  public static getInstance(): BetaCloudBookSource {
    if (!this.instance) {
      this.instance = new BetaCloudBookSource();
    }
    return this.instance;
  }

  public setUserId(userId: string): void {
    this.currentUserId = userId || 'anonymous';
  }

  public getUserId(): string {
    return this.currentUserId;
  }

  /**
   * Get all books accessible to the current user.
   */
  public async getBooks(): Promise<Book[]> {
    const res = await api.get<{ books: Book[] }>('/books');
    return res.books || [];
  }

  /**
   * Get single book metadata. Enforces server authorization.
   */
  public async getBook(id: string): Promise<Book | null> {
    try {
      const res = await api.get<{ book: Book }>(`/books/${id}`);
      return res.book || null;
    } catch (err: any) {
      if (err?.status === 403 || err?.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get lightweight chapter metadata (no paragraphs payload).
   */
  public async getChapterMeta(bookId: string, chapterIndex: number): Promise<{
    chapterId: string;
    chapterIndex: number;
    title: string;
    wordCount: number;
    version: number;
    contentHash?: string;
    updatedAt: string;
  } | null> {
    try {
      return await api.get<any>(`/books/${bookId}/chapters/${chapterIndex}/meta`);
    } catch {
      return null;
    }
  }

  /**
   * Get specific chapter content and paragraphs.
   * Leverages local IndexedDB cache with version-based stale validation.
   * If cached and version is current: ZERO network egress for chapter body!
   */
  public async getChapter(
    bookId: string, 
    chapterIndex: number,
    options?: { expectedVersion?: number; userId?: string }
  ): Promise<Chapter | null> {
    const effectiveUserId = options?.userId || this.currentUserId;

    try {
      // 1. Check local IndexedDB cache
      const cached = await ChapterCache.getCachedChapter(effectiveUserId, bookId, chapterIndex);

      if (cached) {
        // Case A: TOC already provided expectedVersion
        if (options?.expectedVersion !== undefined) {
          if (cached.contentVersion === options.expectedVersion) {
            // CACHE HIT: Exact version match! Zero network egress!
            return {
              id: cached.chapterId,
              bookId: cached.bookId,
              index: cached.chapterIndex,
              title: cached.title,
              wordCount: cached.wordCount,
              paragraphs: cached.paragraphs,
              contentVersion: cached.contentVersion,
              contentHash: cached.contentHash,
              updatedAt: cached.updatedAt,
            };
          }
        } else {
          // Case B: Check lightweight metadata endpoint without downloading paragraphs
          const meta = await this.getChapterMeta(bookId, chapterIndex);
          if (meta && meta.version === cached.contentVersion) {
            // CACHE HIT: Meta matches local version!
            return {
              id: cached.chapterId,
              bookId: cached.bookId,
              index: cached.chapterIndex,
              title: cached.title,
              wordCount: cached.wordCount,
              paragraphs: cached.paragraphs,
              contentVersion: cached.contentVersion,
              contentHash: cached.contentHash,
              updatedAt: cached.updatedAt,
            };
          }
        }
      }

      // 2. Cache miss or version mismatch: Fetch full chapter from server
      const res = await api.get<{ chapter: Chapter }>(`/books/${bookId}/chapters/${chapterIndex}`);
      const serverChapter = res.chapter || null;

      if (serverChapter) {
        // Save to IndexedDB cache
        await ChapterCache.setCachedChapter({
          userId: effectiveUserId,
          bookId,
          chapterId: serverChapter.id,
          chapterIndex,
          title: serverChapter.title,
          paragraphs: serverChapter.paragraphs || [],
          wordCount: serverChapter.wordCount,
          contentVersion: serverChapter.contentVersion || 1,
          contentHash: serverChapter.contentHash,
          updatedAt: serverChapter.updatedAt || new Date().toISOString(),
          cachedAt: Date.now(),
        });
      }

      return serverChapter;
    } catch (err: any) {
      if (err?.status === 403 || err?.status === 404) {
        // Security policy: If server returns 403 (revoked/unauthorized), clear local cache
        await ChapterCache.deleteCachedChapter(effectiveUserId, bookId, chapterIndex);
        return null;
      }
      throw err;
    }
  }

  /**
   * Get Table of Contents for a book with workflow status and contentVersion.
   */
  public async getChapterList(bookId: string): Promise<Array<{ 
    index: number; 
    title: string; 
    wordCount: number; 
    isRead: boolean; 
    isCurrent: boolean;
    status?: string;
    completedAt?: string;
    contentVersion?: number;
    updatedAt?: string;
  }>> {
    const res = await api.get<{ chapters: any[] }>(`/books/${bookId}/chapters`);
    return (res.chapters || []).map((ch: any) => ({
      ...ch,
      index: ch.index ?? ch.chapterIndex,
      chapterIndex: ch.chapterIndex ?? ch.index,
    }));
  }

  /**
   * Mark chapter as completed by Beta Reader.
   */
  public async completeChapter(bookId: string, chapterIndex: number): Promise<{
    completed: boolean;
    status: string;
    completedAt: string;
    completedChaptersCount: number;
    totalChapters: number;
    overallPercentage: number;
  }> {
    const res = await api.post<any>(`/books/${bookId}/chapters/${chapterIndex}/complete`);
    return {
      completed: true,
      status: res.status,
      completedAt: res.completedAt,
      completedChaptersCount: res.completedChaptersCount,
      totalChapters: res.totalChapters,
      overallPercentage: res.overallPercentage,
    };
  }

  /**
   * Get workflow statuses for all chapters of a book.
   */
  public async getChapterWorkflow(bookId: string): Promise<Record<number, {
    status: string;
    startedAt?: string;
    completedAt?: string;
    lastScrollPercent?: number;
  }>> {
    try {
      const res = await api.get<{ workflow: Record<number, any> }>(`/books/${bookId}/workflow`);
      return res.workflow || {};
    } catch {
      return {};
    }
  }

  // =========================================================================
  // Phase 3: Inline Edits & Revisions
  // =========================================================================

  /**
   * List all edits for a chapter.
   */
  public async getChapterEdits(bookId: string, chapterIndex: number): Promise<BetaEdit[]> {
    try {
      const res = await api.get<{ edits: BetaEdit[] }>(`/books/${bookId}/chapters/${chapterIndex}/edits`);
      return res.edits || [];
    } catch {
      return [];
    }
  }

  /**
   * Propose a new edit on a paragraph.
   */
  public async createEdit(
    bookId: string,
    chapterIndex: number,
    payload: {
      paragraphIndex: number;
      startOffset: number;
      endOffset: number;
      originalText: string;
      proposedText: string;
      errorType: ErrorType;
      reason?: string;
    }
  ): Promise<BetaEdit> {
    const res = await api.post<{ edit: BetaEdit }>(`/books/${bookId}/chapters/${chapterIndex}/edits`, payload);
    return res.edit;
  }

  /**
   * Update an existing edit.
   */
  public async updateEdit(
    bookId: string,
    chapterIndex: number,
    editId: string,
    payload: {
      proposedText: string;
      errorType: ErrorType;
      reason?: string;
      expectedVersion?: number;
    }
  ): Promise<BetaEdit> {
    const res = await api.patch<{ edit: BetaEdit }>(`/books/${bookId}/chapters/${chapterIndex}/edits/${editId}`, payload);
    return res.edit;
  }

  /**
   * Soft delete / revert an edit.
   */
  public async deleteEdit(bookId: string, chapterIndex: number, editId: string): Promise<void> {
    await api.delete(`/books/${bookId}/chapters/${chapterIndex}/edits/${editId}`);
  }

  /**
   * Get revision timeline for an edit.
   */
  public async getEditRevisions(bookId: string, chapterIndex: number, editId: string): Promise<EditRevision[]> {
    const res = await api.get<{ revisions: EditRevision[] }>(`/books/${bookId}/chapters/${chapterIndex}/edits/${editId}/revisions`);
    return res.revisions || [];
  }

  // =========================================================================
  // Phase 3: Paragraph Selection Notes
  // =========================================================================

  /**
   * List notes for a chapter.
   */
  public async getChapterNotes(bookId: string, chapterIndex: number): Promise<BetaNote[]> {
    try {
      const res = await api.get<{ notes: BetaNote[] }>(`/books/${bookId}/chapters/${chapterIndex}/notes`);
      return res.notes || [];
    } catch {
      return [];
    }
  }

  /**
   * Create a note on a paragraph selection.
   */
  public async createNote(
    bookId: string,
    chapterIndex: number,
    payload: {
      paragraphIndex: number;
      startOffset: number;
      endOffset: number;
      selectedText?: string;
      note: string;
    }
  ): Promise<BetaNote> {
    const res = await api.post<{ note: BetaNote }>(`/books/${bookId}/chapters/${chapterIndex}/notes`, payload);
    return res.note;
  }

  /**
   * Delete a note.
   */
  public async deleteNote(bookId: string, chapterIndex: number, noteId: string): Promise<void> {
    await api.delete(`/books/${bookId}/chapters/${chapterIndex}/notes/${noteId}`);
  }

  /**
   * Admin Inspector: List all edits for a book.
   */
  public async getAdminBookEdits(bookId: string): Promise<BetaEdit[]> {
    const res = await api.get<{ edits: BetaEdit[] }>(`/admin/books/${bookId}/edits`);
    return res.edits || [];
  }

  // =========================================================================
  // Admin Book Management
  // =========================================================================

  /**
   * Admin save parsed book draft to cloud database.
   */
  public async saveBook(draft: ParsedBookDraft, customMeta?: Partial<NormalizedBook>): Promise<Book> {
    const payload = {
      title: customMeta?.title?.trim() || draft.title,
      author: customMeta?.author?.trim() || draft.author,
      coverUrl: customMeta?.coverUrl || draft.coverUrl,
      coverColor: customMeta?.coverColor || draft.suggestedCoverColor,
      originalFileName: draft.originalFileName,
      fileFormat: draft.fileFormat,
      totalChapters: draft.totalChapters,
      wordCount: draft.wordCount,
      chapters: draft.chapters.map(c => ({
        index: c.index,
        title: c.title,
        paragraphs: c.paragraphs,
        wordCount: c.wordCount,
      })),
    };

    const res = await api.post<{ book: Book }>('/admin/books', payload);
    return res.book;
  }

  /**
   * Admin delete book.
   */
  public async deleteBook(id: string): Promise<void> {
    await api.delete(`/admin/books/${id}`);
  }

  /**
   * Save user reading progress to backend database.
   */
  public async saveProgress(
    bookId: string, 
    chapterIndex: number, 
    percentage: number, 
    chapterTitle: string, 
    scrollPercent?: number, 
    scrollOffset?: number
  ): Promise<void> {
    await api.post(`/books/${bookId}/progress`, {
      chapterIndex,
      percentage,
      chapterTitle,
      scrollPercent: scrollPercent ?? 0,
      scrollOffset: scrollOffset ?? 0,
    });
  }

  /**
   * Get user reading progress from backend database.
   */
  public async getProgress(bookId: string): Promise<ReadingProgress | null> {
    try {
      const res = await api.get<{ progress: ReadingProgress | null }>(`/books/${bookId}/progress`);
      return res.progress;
    } catch {
      return null;
    }
  }

  /**
   * Count accessible books.
   */
  public async countBooks(): Promise<number> {
    const books = await this.getBooks();
    return books.length;
  }

  public async getStorageEstimate(): Promise<StorageEstimateInfo> {
    return {
      usageMB: 0,
      quotaMB: 1000,
      percentUsed: 0,
      isPersistent: true,
    };
  }
}

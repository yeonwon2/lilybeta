export type UserRole = 'ADMIN' | 'BETA_READER';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BookStatus = 'DRAFT' | 'ASSIGNED' | 'IN_BETA' | 'BETA_COMPLETE' | 'ARCHIVED';

export interface BookAssignmentInfo {
  id: string;
  betaUserId: string;
  username: string;
  displayName: string;
  assignedAt: string;
  status: string;
  completedChaptersCount?: number;
  currentChapterIndex?: number;
  overallPercentage?: number;
  lastReadAt?: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  coverColor?: string;
  originalFileName?: string;
  fileFormat: 'TXT' | 'EPUB' | 'DOCX' | 'WEBSITE';
  totalChapters: number;
  wordCount: number;
  status: BookStatus;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  
  // Reading & Workflow metadata
  currentChapter?: number;
  currentChapterTitle?: string;
  progressPercent?: number;
  completedChaptersCount?: number;
  lastReadAt?: string;
  progress?: {
    currentChapter?: number;
    progressPercent?: number;
    completedChaptersCount?: number;
    lastReadAt?: string;
  } | null;

  // Assignment info
  assignments?: BookAssignmentInfo[];
  assignedTo?: BookAssignmentInfo | null;
}

export type ChapterWorkflowStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'COMPLETED';

export interface Chapter {
  id: string;
  bookId: string;
  index: number; // 1-based index
  title: string;
  wordCount: number;
  paragraphs?: string[];
  isRead?: boolean;
  isCurrent?: boolean;
  status?: ChapterWorkflowStatus;
  startedAt?: string;
  completedAt?: string;
  lastScrollPercent?: number;
  contentVersion?: number;
  contentHash?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Assignment {
  id: string;
  bookId: string;
  betaUserId: string;
  assignedBy: string;
  assignedAt: string;
  status: 'ACTIVE' | 'COMPLETED' | 'REVOKED';
  
  // Joined fields
  bookTitle?: string;
  betaUserName?: string;
  betaUserDisplayName?: string;
}

export interface ChapterProgress {
  id: string;
  assignmentId: string;
  bookId: string;
  chapterId?: string;
  betaUserId: string;
  status: ChapterWorkflowStatus;
  chapterIndex: number;
  scrollPercent: number;
  scrollOffset?: number;
  percentage: number;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: 'LOGIN' | 'BOOK_CREATED' | 'BOOK_ASSIGNED' | 'BOOK_OPENED' | 'CHAPTER_OPENED' | 'CHAPTER_COMPLETED';
  bookId?: string;
  chapterId?: string;
  details?: string;
  createdAt: string;
  userName?: string;
  userDisplayName?: string;
  bookTitle?: string;
}

// Reader Theme & Typography Types
export type ReaderFontFamily = 
  | 'Literata' 
  | 'Merriweather' 
  | 'Playfair Display' 
  | 'Be Vietnam Pro' 
  | 'Inter';

export type ReaderPageWidth = 'narrow' | 'normal' | 'wide' | 'full';

export type ReadingMode = 'scroll' | 'page';

export type ReadingPresetId = 'thoai-mai' | 'gon-gang' | 'sach-giay' | 'doc-dem';

export interface ReaderThemeOption {
  id: string;
  name: string;
  className: string;
  previewBg: string;
  previewText: string;
  description?: string;
}

export interface ReaderSettings {
  fontFamily: ReaderFontFamily;
  fontSize: number; // 14 to 32
  fontWeight: 'normal' | 'medium' | 'semibold';
  lineHeight: number; // 1.4 to 2.4
  paragraphSpacing: number; // 0.6 to 2.4
  pageWidth: ReaderPageWidth;
  marginHorizontal: number; // 12 to 48px
  textAlign: 'left' | 'justify';
  firstLineIndent: boolean;
  readingMode: ReadingMode;
  activeThemeId: string;
  selectedPreset?: string;
}

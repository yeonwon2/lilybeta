import { createHash } from 'node:crypto';

export const MAX_SYNC_CHAPTERS = 25;
export class SyncError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export interface SourceChapter {
  editorChapterId: string;
  chapterIndex: number;
  title: string;
  paragraphs: string[];
  updatedAt: string;
  sourceVersion?: string;
  contentHash: string;
}
export interface SyncInput {
  editorBookId: string;
  overwriteExisting: boolean;
  rulesOnly: boolean;
  book: {
    title: string;
    author: string;
    totalChapters?: number;
    pronounRules?: PronounRule[];
    narrativePronounRules?: NarrativePronounRule[];
    contextualPronounRules?: ContextualPronounRule[];
  };
  chapters: SourceChapter[];
}
export interface PronounRule { name: string; from_words: string[]; to_words: string[]; }
export interface NarrativePronounRule { character: string; pronoun: string; note: string; }
export interface ContextualPronounRule { speaker: string; listener: string; self_word: string; target_word: string; note: string; }
export function sourceHash(title: string, paragraphs: string[]): string {
  return createHash('sha256').update(JSON.stringify({ title, paragraphs })).digest('hex');
}
function invalid(message: string): never { throw new SyncError(400, 'INVALID_SYNC_PAYLOAD', message); }
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(`${label} không hợp lệ`);
  return value.trim();
}
function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) invalid(`${label} không hợp lệ`);
  return value.trim();
}
function wordList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || !value.every(item => typeof item === 'string' && item.trim() && item.length <= 100)) invalid(`${label} không hợp lệ`);
  return value.map(item => item.trim());
}
function parsePronounRules(value: unknown): PronounRule[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 500) invalid('book.pronounRules không hợp lệ');
  return value.map((rule: any) => ({
    name: text(rule?.name, 'pronounRules.name', 200),
    from_words: wordList(rule?.from_words, 'pronounRules.from_words'),
    to_words: wordList(rule?.to_words, 'pronounRules.to_words'),
  }));
}
function parseContextualPronounRules(value: unknown): ContextualPronounRule[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 1_000) invalid('book.contextualPronounRules không hợp lệ');
  return value.map((rule: any) => ({
    speaker: text(rule?.speaker, 'contextualPronounRules.speaker', 200),
    listener: optionalText(rule?.listener, 'contextualPronounRules.listener', 200) || '*',
    self_word: text(rule?.self_word, 'contextualPronounRules.self_word', 100),
    target_word: text(rule?.target_word, 'contextualPronounRules.target_word', 100),
    note: optionalText(rule?.note, 'contextualPronounRules.note', 500),
  }));
}
function parseNarrativePronounRules(value: unknown): NarrativePronounRule[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 1_000) invalid('book.narrativePronounRules không hợp lệ');
  return value.map((rule: any) => ({
    character: text(rule?.character, 'narrativePronounRules.character', 200),
    pronoun: text(rule?.pronoun, 'narrativePronounRules.pronoun', 100),
    note: optionalText(rule?.note, 'narrativePronounRules.note', 500),
  }));
}
export function parseSyncInput(value: any): SyncInput {
  if (!value || typeof value !== 'object') invalid('Thiếu payload');
  const editorBookId = text(value.editorBookId, 'editorBookId', 200);
  if (value.overwriteExisting !== undefined && typeof value.overwriteExisting !== 'boolean') invalid('overwriteExisting không hợp lệ');
  const overwriteExisting = value.overwriteExisting === true;
  if (value.rulesOnly !== undefined && typeof value.rulesOnly !== 'boolean') invalid('rulesOnly không hợp lệ');
  const rulesOnly = value.rulesOnly === true;
  const book = {
    title: text(value.book?.title, 'book.title', 500),
    author: value.book?.author === undefined ? 'Chưa rõ tác giả' : text(value.book.author, 'book.author', 300),
    totalChapters: value.book?.totalChapters,
    pronounRules: parsePronounRules(value.book?.pronounRules),
    narrativePronounRules: parseNarrativePronounRules(value.book?.narrativePronounRules),
    contextualPronounRules: parseContextualPronounRules(value.book?.contextualPronounRules),
  };
  if (book.totalChapters !== undefined && (!Number.isSafeInteger(book.totalChapters) || book.totalChapters < 1 || book.totalChapters > 100_000)) invalid('totalChapters không hợp lệ');
  if (!Array.isArray(value.chapters) || (!rulesOnly && value.chapters.length < 1) || value.chapters.length > MAX_SYNC_CHAPTERS || (rulesOnly && value.chapters.length !== 0)) invalid(rulesOnly ? 'Gửi riêng quy tắc không được kèm chương' : `Mỗi batch cần 1–${MAX_SYNC_CHAPTERS} chương`);
  if (rulesOnly && book.pronounRules === undefined && book.narrativePronounRules === undefined && book.contextualPronounRules === undefined) invalid('Cần ít nhất một bảng quy tắc để cập nhật');
  const ids = new Set<string>();
  const indexes = new Set<number>();
  const chapters = value.chapters.map((c: any): SourceChapter => {
    const id = text(c?.editorChapterId, 'editorChapterId', 200);
    if (ids.has(id)) invalid('Trùng editorChapterId trong batch');
    ids.add(id);
    if (!Number.isSafeInteger(c.chapterIndex) || c.chapterIndex < 1 || c.chapterIndex > 100_000 || indexes.has(c.chapterIndex)) invalid('chapterIndex không hợp lệ hoặc trùng');
    indexes.add(c.chapterIndex);
    if (book.totalChapters && c.chapterIndex > book.totalChapters) invalid('chapterIndex vượt tổng chương nguồn');
    const title = text(c.title, 'chapter.title', 500);
    if (!Array.isArray(c.paragraphs) || c.paragraphs.length > 20_000 || !c.paragraphs.every((p: unknown) => typeof p === 'string') || !c.paragraphs.some((p: string) => p.trim())) invalid('paragraphs cần là mảng văn bản có nội dung');
    if (Buffer.byteLength(JSON.stringify(c.paragraphs)) > 1_500_000) invalid('Chương vượt giới hạn 1.5 MB');
    if (typeof c.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.updatedAt) || !Number.isFinite(Date.parse(c.updatedAt))) invalid('updatedAt phải là ISO datetime kèm múi giờ');
    if (Date.parse(c.updatedAt) > Date.now() + 300_000) invalid('updatedAt nằm quá xa trong tương lai');
    if (c.sourceVersion === undefined && c.contentHash === undefined) invalid('Cần sourceVersion hoặc contentHash');
    if (c.sourceVersion !== undefined && typeof c.sourceVersion !== 'string' && !Number.isSafeInteger(c.sourceVersion)) invalid('sourceVersion không hợp lệ');
    const version = c.sourceVersion === undefined ? undefined : text(String(c.sourceVersion), 'sourceVersion', 200);
    const hash = sourceHash(title, c.paragraphs);
    if (c.contentHash !== undefined && c.contentHash !== hash) throw new SyncError(400, 'CONTENT_HASH_MISMATCH', 'Hash nguồn không khớp hash LilyBeta tính lại');
    return { editorChapterId: id, chapterIndex: c.chapterIndex, title, paragraphs: c.paragraphs, updatedAt: new Date(c.updatedAt).toISOString(), sourceVersion: version, contentHash: hash };
  });
  return { editorBookId, overwriteExisting, rulesOnly, book, chapters: chapters.sort((a: SourceChapter, b: SourceChapter) => a.chapterIndex - b.chapterIndex) };
}

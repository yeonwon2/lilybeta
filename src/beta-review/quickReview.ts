export type QuickResult = { chapterIndex: number; status: 'APPROVED' | 'SKIPPED' | 'FAILED'; message: string };
type Client = { get<T>(path: string): Promise<T>; post<T>(path: string, body?: any): Promise<T> };
export async function quickReviewChapters(client: Client, bookId: string, assignmentId: string, indices: number[], onResult: (result: QuickResult) => void, shouldContinue = () => true) {
  for (const chapterIndex of indices) {
    if (!shouldContinue()) break;
    const path = `/admin/books/${encodeURIComponent(bookId)}/assignments/${encodeURIComponent(assignmentId)}/chapters/${chapterIndex}`;
    let result: QuickResult;
    let acceptedCount = 0;
    try {
      const detail = await client.get<any>(`${path}/review`);
      if (detail.chapter.derivedStatus === 'APPROVED') result = { chapterIndex, status: 'SKIPPED', message: 'Đã duyệt trước đó, giữ nguyên.' };
      else {
        if (!detail.chapter.isBetaCompleted) throw new Error('Beta chưa hoàn thành chương.');
        if (detail.counts.changesRequested > 0) throw new Error('Có đề xuất đang yêu cầu sửa lại; cần xử lý riêng.');
        if (detail.approvedVersion.conflict) throw new Error('Có chỉnh sửa chồng lấn; cần xử lý riêng.');
        const pending = detail.edits.filter((edit: any) => edit.status === 'ACTIVE' && edit.derivedReviewStatus === 'PENDING').map((edit: any) => ({ id: edit.id, version: edit.version, revisionNumber: edit.version }));
        for (let i = 0; i < pending.length; i += 200) {
          if (!shouldContinue()) return;
          await client.post(`${path}/accept-pending`, { edits: pending.slice(i, i + 200) });
          acceptedCount += pending.slice(i, i + 200).length;
        }
        if (!shouldContinue()) return;
        // Keep the existing completion, pending-review and overlap guards + snapshot writer.
        await client.post(`${path}/approve`);
        result = { chapterIndex, status: 'APPROVED', message: `Đã phê duyệt; chấp nhận ${pending.length} đề xuất đang chờ.` };
      }
    } catch (error: any) { result = { chapterIndex, status: 'FAILED', message: `${error.message || 'Chưa hoàn tất.'}${acceptedCount ? ` Đã chấp nhận ${acceptedCount} đề xuất, nhưng chương chưa được duyệt.` : ''}` }; }
    onResult(result);
  }
}

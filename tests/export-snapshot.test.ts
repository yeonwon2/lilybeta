import assert from 'node:assert/strict';
import { approvedText } from '../server/exports/exportApproved.js';
const edit = { editId: 'e1', paragraphIndex: 0, startOffset: 0, endOffset: 3, afterText: 'Chàng', revisionNumber: 1 };
const row = { status: 'APPROVED', paragraphs: ['Hắn nhìn nàng.'], approved_edits_snapshot: [edit], review_snapshot_version: 2, updated_at: '2026-08-20T00:00:00Z', approved_at: '2026-08-21T00:00:00Z' };
assert.equal(approvedText(row), 'Chàng nhìn nàng.');
for (const invalid of [
  { ...row, status: 'IN_REVIEW' }, { ...row, approved_at: null }, { ...row, updated_at: '2026-08-22T00:00:00Z' },
  { ...row, approved_edits_snapshot: null }, { ...row, approved_edits_snapshot: '[broken' }, { ...row, review_snapshot_version: 0 },
  { ...row, approved_edits_snapshot: [{ ...edit, endOffset: 999 }] }, { ...row, approved_edits_snapshot: [{ ...edit, paragraphIndex: 10 }] },
  { ...row, approved_edits_snapshot: [edit, { ...edit, editId: 'e2' }] }, { ...row, approved_edits_snapshot: [edit, { ...edit, editId: 'e2', startOffset: 2 }] },
]) assert.throws(() => approvedText(invalid));
console.log('PASS: immutable approval snapshot, timestamp guard, invalid anchors, overlap and missing snapshot blocked');

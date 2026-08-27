import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewChapterContent } from '../src/pages/admin/review/ReviewChapterContent.js';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// Isolate test database to prevent polluting persistent lilybeta.db
const testDbFile = path.join(process.cwd(), 'data', `test_review_${Date.now()}.db`);
process.env.DB_PATH = testDbFile;

// Dynamic imports so DatabaseSync initializes with testDbFile
const { createApp } = await import('../server/app.js');
const { runMigrations } = await import('../server/migrations/runner.js');
const { queryOne, db } = await import('../server/db/database.js');

let passedAssertions = 0;
const assert = (condition: boolean, msg: string) => {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passedAssertions++;
  console.log(`  ✓ ${msg}`);
};

const runReviewSecurityTests = async () => {
  console.log('====================================================');
  console.log('🚀 STARTING LILYBETA PHASE 4 ADMIN REVIEW & APPROVAL TEST');
  console.log('====================================================\n');

  await runMigrations();

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[Test Server] Listening on ${baseUrl}`);

  try {
    // 1. Admin Login
    console.log('\n[Phase 1] Admin Authentication');
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    assert(adminLoginRes.status === 200, 'Admin login returns 200 OK');
    const adminToken = (await adminLoginRes.json()).token;

    // 2. Admin creates Beta Reader A & Beta Reader B
    console.log('\n[Phase 2] Admin Provisions Beta Readers');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const betaAUser = `beta_a_${randomSuffix}`;
    const betaBUser = `beta_b_${randomSuffix}`;

    const createBetaARes = await fetch(`${baseUrl}/api/admin/beta-readers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: betaAUser, password: 'password123', displayName: 'Beta Reader A' }),
    });
    assert(createBetaARes.status === 201, 'Create Beta Reader A returns 201 Created');
    const userA = (await createBetaARes.json()).reader;

    const createBetaBRes = await fetch(`${baseUrl}/api/admin/beta-readers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: betaBUser, password: 'password123', displayName: 'Beta Reader B' }),
    });
    assert(createBetaBRes.status === 201, 'Create Beta Reader B returns 201 Created');
    const userB = (await createBetaBRes.json()).reader;

    // Login Beta Readers
    const loginARes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: betaAUser, password: 'password123' }),
    });
    const tokenA = (await loginARes.json()).token;

    const loginBRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: betaBUser, password: 'password123' }),
    });
    const tokenB = (await loginBRes.json()).token;

    // 3. Admin Uploads Book & Assigns to Beta A
    console.log('\n[Phase 3] Book Upload & Assignment');
    const uploadRes = await fetch(`${baseUrl}/api/admin/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: `Tác Phẩm Review (${randomSuffix})`,
        author: 'Tác Giả Kiểm Thử',
        originalFileName: 'review.txt',
        fileFormat: 'TXT',
        chapters: [
          {
            index: 1,
            title: 'Chương 1: Khởi Đầu',
            paragraphs: ['Hắn nhìn nàng với ánh mắt trầm ngâm.', 'Gió thổi qua rặng liễu ven hồ.'],
          },
          {
            index: 2,
            title: 'Chương 2: Tiếp Diễn',
            paragraphs: ['Một ngày mới bắt đầu trên kinh thành.'],
          },
        ],
      }),
    });
    assert(uploadRes.status === 201, 'Upload book returns 201 Created');
    const book = (await uploadRes.json()).book;

    const assignRes = await fetch(`${baseUrl}/api/admin/books/${book.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ betaUserId: userA.id }),
    });
    assert(assignRes.status === 200, 'Assign book to Beta A returns 200 OK');
    const assignment = (await assignRes.json()).assignment;

    // 4. Beta A creates an Edit (Revision 1)
    console.log('\n[Phase 4] Beta A creates Edit (Revision 1)');
    const createEditRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        paragraphIndex: 0,
        startOffset: 0,
        endOffset: 3, // 'Hắn'
        originalText: 'Hắn',
        proposedText: 'Chàng',
        errorType: 'XUNG_HO',
        reason: 'Sửa xưng hô nhân vật chính',
      }),
    });
    assert(createEditRes.status === 201, 'Beta A creates edit returns 201 Created');
    const edit1 = (await createEditRes.json()).edit;
    assert(edit1.version === 1, 'Initial edit version is 1');
    assert(edit1.reviewStatus === 'PENDING', 'Initial reviewStatus is PENDING');

    // 5. Admin queries Chapter Review Detail
    console.log('\n[Phase 5] Admin queries Chapter Review Detail');
    const reviewDetailRes = await fetch(
      `${baseUrl}/api/admin/books/${book.id}/assignments/${assignment.id}/chapters/1/review`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert(reviewDetailRes.status === 200, 'Admin queries review detail returns 200 OK');
    const reviewDetail = await reviewDetailRes.json();
    assert(reviewDetail.edits.length === 1, 'Review detail contains 1 edit');
    assert(reviewDetail.edits[0].derivedReviewStatus === 'PENDING', 'Edit derived review status is PENDING');

    // Render the actual API response, not a hand-written fixture with different field names.
    for (const contentLayer of ['working', 'approved', 'original'] as const) {
      const html = renderToStaticMarkup(createElement(ReviewChapterContent, {
        chapterData: reviewDetail, contentLayer, selectedEdit: null, onSelectEdit: () => {},
      }));
      assert(html.includes('Chương 1: Khởi Đầu'), `${contentLayer}: chapter title renders`);
      assert(html.includes('Gió thổi qua rặng liễu ven hồ.'), `${contentLayer}: API paragraphs render without crashing`);
      assert(html.includes(contentLayer === 'working' ? 'Chàng' : 'Hắn'), `${contentLayer}: correct original/proposed text`);
    }


    // 6. Admin accepts Revision 1
    console.log('\n[Phase 6] Admin accepts Revision 1');
    const acceptRes = await fetch(`${baseUrl}/api/admin/edits/${edit1.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'ACCEPTED',
        comment: 'Đồng ý sửa thành Chàng',
        expectedRevisionNumber: 1,
        expectedEditVersion: 1,
      }),
    });
    assert(acceptRes.status === 201, 'Admin accepts edit returns 201 Created');
    const acceptData = await acceptRes.json();
    assert(acceptData.review.decision === 'ACCEPTED', 'Review record decision is ACCEPTED');
    assert(acceptData.review.reviewedRevisionNumber === 1, 'Review bound to Revision 1');

    // Verify Approved Version uses Revision 1
    const approvedRes1 = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/approved?assignmentId=${assignment.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(approvedRes1.status === 200, 'Get approved version returns 200 OK');
    const approvedData1 = await approvedRes1.json();
    assert(approvedData1.paragraphs[0].startsWith('Chàng'), 'Approved Version replaces Hắn with Chàng');

    // 7. Invariant Test: Beta A modifies edit to Revision 2 -> Revision 2 is PENDING, Approved Version remains Revision 1
    console.log('\n[Phase 7] Invariant: Beta A creates Revision 2 -> Approved Version preserved');
    const updateEditRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits/${edit1.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        proposedText: 'Thiếu hiệp',
        errorType: 'XUNG_HO',
        reason: 'Đổi thành Thiếu hiệp cho trang trọng',
        expectedVersion: 1,
      }),
    });
    assert(updateEditRes.status === 200, 'Beta updates edit to Revision 2 returns 200 OK');
    const updatedEdit = (await updateEditRes.json()).edit;
    assert(updatedEdit.version === 2, 'Edit version incremented to 2');
    assert(updatedEdit.reviewStatus === 'PENDING', 'Current Revision 2 reviewStatus is PENDING');

    // Approved Version must STILL use Revision 1 ('Chàng')!
    const approvedRes2 = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/approved?assignmentId=${assignment.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const approvedData2 = await approvedRes2.json();
    assert(approvedData2.paragraphs[0].startsWith('Chàng'), 'Approved Version strictly keeps Revision 1 text (Chàng)');
    const updatedDetail = await (await fetch(
      `${baseUrl}/api/admin/books/${book.id}/assignments/${assignment.id}/chapters/1/review`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    )).json();
    for (const [contentLayer, expected] of [['working', 'Thiếu hiệp'], ['approved', 'Chàng'], ['original', 'Hắn']] as const) {
      const html = renderToStaticMarkup(createElement(ReviewChapterContent, {
        chapterData: updatedDetail, contentLayer, selectedEdit: null, onSelectEdit: () => {},
      }));
      assert(html.includes(expected), `${contentLayer}: UI uses correct revision from API response`);
    }

    assert(!approvedData2.paragraphs[0].startsWith('Thiếu hiệp'), 'Unreviewed Revision 2 text is NOT in Approved Version');

    // 8. Stale Review Protection: Admin reviews with stale expectedEditVersion = 1
    console.log('\n[Phase 8] Stale Review Protection (409 REVIEW_STALE)');
    const staleReviewRes = await fetch(`${baseUrl}/api/admin/edits/${edit1.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'ACCEPTED',
        expectedEditVersion: 1, // Stale! Server is at 2!
      }),
    });
    assert(staleReviewRes.status === 409, 'Stale review request rejected with 409 Conflict');
    const staleData = await staleReviewRes.json();
    assert(staleData.code === 'REVIEW_STALE', 'Error code is REVIEW_STALE');

    // 9. Admin accepts Revision 2 -> Approved Version updates to 'Thiếu hiệp'
    console.log('\n[Phase 9] Admin accepts Revision 2 -> Approved Version updates');
    const acceptRev2Res = await fetch(`${baseUrl}/api/admin/edits/${edit1.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'ACCEPTED',
        expectedRevisionNumber: 2,
        expectedEditVersion: 2,
      }),
    });
    assert(acceptRev2Res.status === 201, 'Admin accepts Revision 2 returns 201 Created');

    const approvedRes3 = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/approved?assignmentId=${assignment.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const approvedData3 = await approvedRes3.json();
    assert(approvedData3.paragraphs[0].startsWith('Thiếu hiệp'), 'Approved Version updated to Revision 2 text (Thiếu hiệp)');

    // 10. Request Changes Workflow & Validation
    console.log('\n[Phase 10] Request Changes Workflow');
    // Request changes without comment must fail
    const reqChangesNoCommentRes = await fetch(`${baseUrl}/api/admin/edits/${edit1.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'CHANGES_REQUESTED',
        expectedEditVersion: 2,
      }),
    });
    assert(reqChangesNoCommentRes.status === 400, 'Request changes without comment rejected with 400 Bad Request');

    const reqChangesRes = await fetch(`${baseUrl}/api/admin/edits/${edit1.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'CHANGES_REQUESTED',
        comment: 'Hãy dùng lại từ Chàng như ban đầu',
        expectedEditVersion: 2,
      }),
    });
    assert(reqChangesRes.status === 201, 'Request changes with comment returns 201 Created');

    // Beta Reader sees feedback
    const betaListEditsRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const betaEditsData = await betaListEditsRes.json();
    assert(betaEditsData.edits[0].reviewStatus === 'CHANGES_REQUESTED', 'Beta sees reviewStatus = CHANGES_REQUESTED');
    assert(betaEditsData.edits[0].reviewComment === 'Hãy dùng lại từ Chàng như ban đầu', 'Beta sees review comment');

    // Beta Reader revises to Revision 3
    const betaReviseRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits/${edit1.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        proposedText: 'Chàng',
        errorType: 'XUNG_HO',
        reason: 'Đã sửa lại theo yêu cầu của Admin',
        expectedVersion: 2,
      }),
    });
    assert(betaReviseRes.status === 200, 'Beta submits Revision 3 returns 200 OK');
    const rev3Edit = (await betaReviseRes.json()).edit;
    assert(rev3Edit.version === 3, 'Edit version incremented to 3');
    assert(rev3Edit.reviewStatus === 'PENDING', 'Revision 3 reviewStatus is PENDING again');

    // [Bug 1 Test] Admin reviews edit version 3 but passes stale expectedRevisionNumber 1 -> must return 409 REVIEW_STALE
    const staleRevRes = await fetch(`${baseUrl}/api/admin/edits/${edit1.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'ACCEPTED',
        expectedRevisionNumber: 1,
        expectedEditVersion: 3,
      }),
    });
    assert(staleRevRes.status === 409, 'Review with stale expectedRevisionNumber rejected with 409 Conflict');
    const staleRevData = await staleRevRes.json();
    assert(staleRevData.code === 'REVIEW_STALE', 'Error code is REVIEW_STALE');

    // [Bug 1 Test] Review with non-existent revision -> rejected with 409 REVIEW_STALE
    const nonExistentRevRes = await fetch(`${baseUrl}/api/admin/edits/${edit1.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'ACCEPTED',
        expectedRevisionNumber: 999,
        expectedEditVersion: 3,
      }),
    });
    assert(nonExistentRevRes.status === 409, 'Review with non-existent revision rejected with 409 Conflict');

    // Admin accepts Revision 3 with matching expectedRevisionNumber & expectedEditVersion
    const acceptRev3Res = await fetch(`${baseUrl}/api/admin/edits/${edit1.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'ACCEPTED',
        expectedRevisionNumber: 3,
        expectedEditVersion: 3,
      }),
    });
    assert(acceptRev3Res.status === 201, 'Admin accepts Revision 3 returns 201 Created');

    // 11. Security & IDOR Defenses
    console.log('\n[Phase 11] Security & IDOR Defenses');
    // Beta Reader A attempts to accept edit
    const betaAcceptRes = await fetch(`${baseUrl}/api/admin/edits/${edit1.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ decision: 'ACCEPTED' }),
    });
    assert(betaAcceptRes.status === 403, 'Beta Reader attempting to review edit rejected with 403 Forbidden');

    // Beta Reader A attempts to approve chapter
    const betaApproveRes = await fetch(
      `${baseUrl}/api/admin/books/${book.id}/assignments/${assignment.id}/chapters/1/approve`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
      }
    );
    assert(betaApproveRes.status === 403, 'Beta Reader attempting to approve chapter rejected with 403 Forbidden');

    // Beta Reader B attempts to view Beta A's review workspace
    const betaBCrossRes = await fetch(
      `${baseUrl}/api/admin/books/${book.id}/assignments/${assignment.id}/chapters/1/review`,
      { headers: { Authorization: `Bearer ${tokenB}` } }
    );
    assert(betaBCrossRes.status === 403, 'Beta B accessing Admin review workspace rejected with 403 Forbidden');

    // 12. Chapter Approval & Invalidation Lifecycle
    console.log('\n[Phase 12] Chapter Approval & Invalidation Lifecycle');

    // [Bug 2 Test] Beta chapter is IN_PROGRESS (not completed) + all edits reviewed -> approve must FAIL with 400
    const prematureApproveRes = await fetch(
      `${baseUrl}/api/admin/books/${book.id}/assignments/${assignment.id}/chapters/1/approve`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    assert(prematureApproveRes.status === 400, 'Admin approving IN_PROGRESS chapter rejected with 400 Bad Request');
    const prematureData = await prematureApproveRes.json();
    assert(prematureData.code === 'CHAPTER_NOT_BETA_COMPLETE', 'Error code is CHAPTER_NOT_BETA_COMPLETE');

    // Beta Reader marks chapter 1 as COMPLETED
    const completeChapterRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(completeChapterRes.status === 200, 'Beta marks chapter completed returns 200 OK');

    // Admin approves chapter 1 now that it is COMPLETED
    const approveChapterRes = await fetch(
      `${baseUrl}/api/admin/books/${book.id}/assignments/${assignment.id}/chapters/1/approve`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    assert(approveChapterRes.status === 200, 'Admin approves completed chapter returns 200 OK');
    const approveData = await approveChapterRes.json();
    assert(approveData.success === true, 'Chapter approved successfully');

    // Database check: chapter review is APPROVED
    const dbChapterRev = queryOne<any>(
      'SELECT status FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = 1',
      assignment.id
    );
    assert(dbChapterRev?.status === 'APPROVED', 'Database records chapter as APPROVED');

    // Beta A creates a new edit post-approval -> Chapter must automatically REOPEN!
    const postApprovalEditRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        paragraphIndex: 1,
        startOffset: 0,
        endOffset: 3, // 'Gió'
        originalText: 'Gió',
        proposedText: 'Cơn gió',
        errorType: 'VAN_PHONG',
      }),
    });
    assert(postApprovalEditRes.status === 201, 'Beta creates post-approval edit returns 201 Created');

    // Verify chapter was automatically transitioned to REOPENED!
    const dbChapterRevAfter = queryOne<any>(
      'SELECT status FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = 1',
      assignment.id
    );
    assert(dbChapterRevAfter?.status === 'REOPENED', 'Chapter approval automatically transitioned to REOPENED upon new edit!');

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passedAssertions} PHASE 4 ADMIN REVIEW & APPROVAL ASSERTIONS PASSED!`);
    console.log('====================================================\n');
  } finally {
    server.close();
    try {
      db.close();
    } catch {}
    if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
    if (fs.existsSync(`${testDbFile}-wal`)) fs.unlinkSync(`${testDbFile}-wal`);
    if (fs.existsSync(`${testDbFile}-shm`)) fs.unlinkSync(`${testDbFile}-shm`);
  }
};

runReviewSecurityTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Review security test suite failed with error:\n', err);
    process.exit(1);
  });

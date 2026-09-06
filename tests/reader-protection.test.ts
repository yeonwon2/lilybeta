import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const reader = readFileSync('src/pages/beta/BetaReaderView.tsx','utf8');
const watermark = readFileSync('src/components/reader/Watermark.tsx','utf8');

// Copy/cut/drag/context-menu are no longer blocked on the reader page.
for (const event of ['onCopy','onCut','onDragStart','onContextMenu']) assert.ok(!reader.includes(event));
assert.doesNotMatch(reader, /reader-deterrence/);

// Editing requires neither selecting text nor a modal: a click on the paragraph
// turns it into an editable textarea in place, auto-saved on blur.
assert.match(reader, /handleStartEditing/);
assert.match(reader, /onClick=\{\(e\) => handleStartEditing\(e, idx, p, paraEdits\)\}/);
assert.match(reader, /handleFinishEditing/);
assert.match(reader, /<textarea/);

// The old selection/modal/note components were removed as dead code.
for (const removed of [
  'src/components/reader/InlineSelectionToolbar.tsx',
  'src/components/reader/EditBottomSheet.tsx',
  'src/components/reader/EditDetailModal.tsx',
  'src/components/reader/NoteModal.tsx',
  'src/components/reader/RevisionHistoryDrawer.tsx',
]) assert.ok(!existsSync(removed), `${removed} should have been removed`);

assert.match(watermark,/user.username/);
assert.match(watermark,/pointer-events-none/);
assert.match(watermark,/user.role !== 'BETA_READER'/);
console.log('PASS: No copy/selection blocking, click-to-edit paragraphs in place, non-interactive account watermark');

const css = readFileSync('src/index.css','utf8');
const watermarkRule = css.match(/\.reader-watermark\s*\{([^}]+)\}/)?.[1];
assert.ok(watermarkRule);
assert.doesNotMatch(watermarkRule!, /opacity\s*:/, 'Do not multiply label opacity by container opacity');
assert.match(watermark, /opacity: 0.04/);
assert.match(watermark, /z-\[60\]/);

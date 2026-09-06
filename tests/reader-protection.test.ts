import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const reader = readFileSync('src/pages/beta/BetaReaderView.tsx','utf8');
const toolbar = readFileSync('src/components/reader/InlineSelectionToolbar.tsx','utf8');
const watermark = readFileSync('src/components/reader/Watermark.tsx','utf8');

// Copy/cut/drag/context-menu are no longer blocked on the reader page.
for (const event of ['onCopy','onCut','onDragStart','onContextMenu']) assert.ok(!reader.includes(event));
assert.doesNotMatch(reader, /reader-deterrence/);

// Editing no longer requires selecting text: a click on a paragraph opens the edit sheet directly.
assert.match(reader, /handleParagraphClick/);
assert.match(reader, /onClick=\{\(e\) => handleParagraphClick\(e, idx, p\)\}/);
assert.doesNotMatch(toolbar, /onOpenEdit/);

assert.match(toolbar,/bottom: 'calc\(env\(safe-area-inset-bottom/);
assert.doesNotMatch(toolbar,/style=\{\{ top:/);
assert.match(toolbar,/onPointerDown=\{e => e.preventDefault\(\)\}/);
assert.match(watermark,/user.username/);
assert.match(watermark,/pointer-events-none/);
assert.match(watermark,/user.role !== 'BETA_READER'/);
console.log('PASS: No copy/selection blocking, click-to-edit paragraphs, bottom note toolbar, non-interactive account watermark');

const css = readFileSync('src/index.css','utf8');
const watermarkRule = css.match(/\.reader-watermark\s*\{([^}]+)\}/)?.[1];
assert.ok(watermarkRule);
assert.doesNotMatch(watermarkRule!, /opacity\s*:/, 'Do not multiply label opacity by container opacity');
assert.match(watermark, /opacity: 0.04/);
assert.match(watermark, /z-\[60\]/);

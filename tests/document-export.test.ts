import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { exportTxt, exportDocx, exportPdf, chapterHeading, orderedChapters } from '../src/exports/documentExport.js';
import { TxtImporter } from '../src/book-engine/importers/TxtImporter.js';
const chapters = [
  { chapterNumber: 101, title: 'Chương 101: Gặp lại', content: 'Chàng nhìn nàng.\n\n“Ngày mai, chúng ta lại gặp nhé!”\nNàng mỉm cười & gật đầu.\n\n<script>Văn bản, không thực thi</script>' },
  { chapterNumber: 105, title: 'Lời hẹn', content: 'Trời đã sáng.\n\nĐường phố rộn ràng tiếng bước chân.' },
];
const text = exportTxt(chapters);
assert.ok(text.startsWith('\uFEFFChương 101: Gặp lại'));
assert.ok(text.includes('Chương 105: Lời hẹn'));
assert.ok(text.includes(chapters[0].content));
assert.equal(chapterHeading({ ...chapters[0], title: 'Chương 101' }), 'Chương 101');
assert.throws(() => orderedChapters([chapters[0], chapters[0]]));
assert.throws(() => orderedChapters([{ ...chapters[0], chapterNumber: -1 }]));
const importedTxt = await TxtImporter.parseFile(new File([text], 'synthetic.txt', { type: 'text/plain' }));
assert.equal(importedTxt.chapters.length, 2);
const docx = await exportDocx(chapters);
const zip = await JSZip.loadAsync(await docx.arrayBuffer());
const document = await zip.file('word/document.xml')!.async('text');
assert.ok(document.includes('Chàng nhìn nàng.'));
assert.ok(document.includes('Nàng mỉm cười &amp; gật đầu.'));
assert.ok(document.includes('&lt;script&gt;Văn bản, không thực thi&lt;/script&gt;'));
assert.ok(zip.file('word/styles.xml'));
assert.ok(!Object.keys(zip.files).some(f => /vba|macro/i.test(f)));
const pdf = await exportPdf(chapters, 'Truyện thử nghiệm');
assert.ok(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5)) === '%PDF-');
const output = process.env.EXPORT_QA_DIR || mkdtempSync(join(tmpdir(), 'lily-export-qa-'));
writeFileSync(join(output, 'approved.txt'), text);
writeFileSync(join(output, 'approved.docx'), new Uint8Array(await docx.arrayBuffer()));
writeFileSync(join(output, 'approved.pdf'), new Uint8Array(await pdf.arrayBuffer()));
console.log('PASS: TXT heading/import, exact approved text, DOCX XML safety and PDF generation. QA files:', output);

// Optional integration against an existing LilyHub checkout. No LilyHub files or data are changed.
if (process.env.LILYHUB_REPO) {
  const adminDir = join(process.env.LILYHUB_REPO, 'src/components/admin');
  const { readDraftFile } = await import(pathToFileURL(join(adminDir, 'draftFileImport.js')).href);
  const source = readFileSync(join(adminDir, 'chapterPublishing.js'), 'utf8')
    .replace(/import \{ base44, chapterContentKeyFor, saveChapterContent, deleteChapterContent \} from '@\/api\/base44Client';/, 'const base44 = null, chapterContentKeyFor = null, saveChapterContent = null, deleteChapterContent = null;')
    .replace("'./chapterContentCleaner'", JSON.stringify(pathToFileURL(join(adminDir, 'chapterContentCleaner.js')).href));
  const { parseChapterDraft } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const imported = await readDraftFile(new File([text], 'approved.txt', { type: 'text/plain' }));
  const parsed = parseChapterDraft(imported, 'synthetic-only');
  assert.deepEqual(parsed.chapters.map((c: any) => c.chapter_number), [101, 105]);
  assert.equal(parsed.chapters[0].content, chapters[0].content);
  assert.equal(parsed.warnings.filter((w: any) => w.type === 'error').length, 0);
  console.log('PASS: existing LilyHub readDraftFile + parseChapterDraft recognize exported TXT exactly; no new importer.');
}

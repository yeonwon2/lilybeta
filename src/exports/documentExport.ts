export type ExportChapter = { chapterNumber: number; title: string; content: string };
export type ExportFormat = 'txt' | 'docx' | 'pdf';
export const MAX_EXPORT_BYTES = 10_000_000;

export function chapterHeading(chapter: ExportChapter): string {
  const title = chapter.title.replace(/[\r\n]+/g, ' ').trim();
  const suffix = title.replace(/^(?:chương|chuong|chapter)\s*\d+\s*(?::|[-–—.]\s*)?\s*/i, '').trim();
  return `Chương ${chapter.chapterNumber}${suffix ? `: ${suffix}` : ''}`;
}
export function orderedChapters(chapters: ExportChapter[]): ExportChapter[] {
  if (!chapters.length || chapters.length > 1000) throw new Error('Chọn 1–1000 chương mỗi lần xuất.');
  const ordered = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const seen = new Set<number>(); let size = 0;
  for (const chapter of ordered) {
    if (!Number.isSafeInteger(chapter.chapterNumber) || chapter.chapterNumber < 1 || seen.has(chapter.chapterNumber) || typeof chapter.title !== 'string' || typeof chapter.content !== 'string' || !chapter.content.trim()) throw new Error('Số chương hoặc nội dung không hợp lệ.');
    seen.add(chapter.chapterNumber); size += new TextEncoder().encode(chapter.content).length;
  }
  if (size > MAX_EXPORT_BYTES) throw new Error('Nội dung vượt 10 MB. Hãy chọn ít chương hơn.');
  return ordered;
}
export function exportTxt(chapters: ExportChapter[]): string {
  // No book cover/preamble: LilyHub's existing TXT importer recognizes these headings.
  return '\uFEFF' + orderedChapters(chapters).map(c => `${chapterHeading(c)}\n\n${c.content}`).join('\n\n\n');
}
function xml(text: string): string {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new Error('Văn bản có ký tự không hợp lệ với Word. Hãy xuất TXT.');
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function run(text: string) {
  return '<w:r>' + text.split('\n').map(line => `<w:t xml:space="preserve">${xml(line)}</w:t>`).join('<w:br/>') + '</w:r>';
}
export async function exportDocx(chapters: ExportChapter[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const ordered = orderedChapters(chapters);
  const zip = new JSZip();
  const body = ordered.map((c, index) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/>${index ? '<w:pageBreakBefore/>' : ''}</w:pPr>${run(chapterHeading(c))}</w:p>` + c.content.split('\n\n').map(p => `<w:p>${run(p)}</w:p>`).join('')).join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="26"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
export async function exportPdf(chapters: ExportChapter[], title: string): Promise<Blob> {
  const ordered = orderedChapters(chapters);
  if (ordered.reduce((sum, chapter) => sum + new TextEncoder().encode(chapter.content).length, 0) > 1_000_000) throw new Error('PDF tối đa 1 MB nội dung mỗi lượt để tránh treo thiết bị. Chọn ít chương hơn hoặc dùng TXT/DOCX.');
  // Large PDF engine/fonts are fetched only when PDF is selected, never on page load.
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  // pdfmake 0.2.20 exposes this method; its DefinitelyTyped declarations lag behind.
  (pdfMake as typeof pdfMake & { addVirtualFileSystem(vfs: Record<string, string>): void })
    .addVirtualFileSystem(fonts as unknown as Record<string, string>);
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf({
        info: { title }, pageSize: 'A4', pageMargins: [54, 54, 54, 54],
        defaultStyle: { font: 'Roboto', fontSize: 12, lineHeight: 1.4 },
        content: ordered.flatMap((c, index) => [
          { text: chapterHeading(c), fontSize: 17, bold: true, margin: [0, 0, 0, 18] as [number, number, number, number], ...(index ? { pageBreak: 'before' as const } : {}) },
          ...c.content.split('\n\n').map(text => ({ text, margin: [0, 0, 0, 10] as [number, number, number, number] })),
        ]),
      }).getBlob(resolve);
    } catch (error) { reject(error); }
  });
}
export async function exportDocument(chapters: ExportChapter[], format: ExportFormat, title: string): Promise<Blob> {
  if (format === 'txt') return new Blob([exportTxt(chapters)], { type: 'text/plain;charset=utf-8' });
  if (format === 'docx') return exportDocx(chapters);
  if (format === 'pdf') return exportPdf(chapters, title);
  throw new Error('Định dạng không được hỗ trợ.');
}

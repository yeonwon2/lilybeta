import React, { useEffect, useState, useRef } from 'react';
import { Edit3, MessageSquare, AlertCircle } from 'lucide-react';

export interface SelectionRangeInfo {
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  rect: DOMRect;
}

interface InlineSelectionToolbarProps {
  onOpenEdit: (range: SelectionRangeInfo) => void;
  onOpenNote: (range: SelectionRangeInfo) => void;
}

export const InlineSelectionToolbar: React.FC<InlineSelectionToolbarProps> = ({
  onOpenEdit,
  onOpenNote,
}) => {
  const [selectionInfo, setSelectionInfo] = useState<SelectionRangeInfo | null>(null);
  const [crossParagraphWarning, setCrossParagraphWarning] = useState<boolean>(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setSelectionInfo(null);
        setCrossParagraphWarning(false);
        return;
      }

      const selectedText = selection.toString().trim();
      if (!selectedText || selectedText.length === 0) {
        setSelectionInfo(null);
        setCrossParagraphWarning(false);
        return;
      }

      const range = selection.getRangeAt(0);

      // Find the enclosing paragraph element
      const startNode = range.startContainer;
      const endNode = range.endContainer;

      const startPara = (startNode.nodeType === Node.ELEMENT_NODE ? startNode as HTMLElement : startNode.parentElement)?.closest('[data-paragraph-index]') as HTMLElement | null;
      const endPara = (endNode.nodeType === Node.ELEMENT_NODE ? endNode as HTMLElement : endNode.parentElement)?.closest('[data-paragraph-index]') as HTMLElement | null;

      if (!startPara || !endPara) {
        setSelectionInfo(null);
        setCrossParagraphWarning(false);
        return;
      }

      // Check single paragraph rule
      if (startPara !== endPara) {
        const rect = range.getBoundingClientRect();
        setSelectionInfo({
          paragraphIndex: -1,
          startOffset: 0,
          endOffset: 0,
          selectedText,
          rect,
        });
        setCrossParagraphWarning(true);
        return;
      }

      setCrossParagraphWarning(false);
      const pIndex = parseInt(startPara.getAttribute('data-paragraph-index') || '0', 10);
      const originalText = startPara.getAttribute('data-original-text') || startPara.textContent || '';

      // Compute UTF-16 offset relative to original paragraph text
      // We look up selectedText within originalText around cursor
      let startOffset = originalText.indexOf(selectedText);
      if (startOffset === -1) {
        // Fallback normalized match
        startOffset = originalText.toLowerCase().indexOf(selectedText.toLowerCase());
      }

      if (startOffset === -1) {
        setSelectionInfo(null);
        return;
      }

      const endOffset = startOffset + selectedText.length;
      const rect = range.getBoundingClientRect();

      setSelectionInfo({
        paragraphIndex: pIndex,
        startOffset,
        endOffset,
        selectedText,
        rect,
      });
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  if (!selectionInfo) return null;

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 left-3 right-3 mx-auto max-w-sm animate-in fade-in duration-100"
      role="toolbar"
      aria-label="Thao tác với văn bản đã chọn"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()} // Prevent clearing selection
    >
      {crossParagraphWarning ? (
        <div className="bg-ink-950 text-white text-[11px] px-3 py-1.5 rounded-xl shadow-lg border border-white/10 flex items-center gap-1.5 whitespace-nowrap">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Chỉ chọn trong 1 đoạn văn</span>
        </div>
      ) : (
        <div className="bg-ink-950/95 backdrop-blur-md text-white rounded-2xl shadow-xl border border-white/15 p-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onOpenEdit(selectionInfo);
              window.getSelection()?.removeAllRanges();
              setSelectionInfo(null);
            }}
            className="flex-1 min-h-12 flex justify-center items-center gap-2 px-4 py-3 rounded-xl hover:bg-white/20 text-sm font-semibold transition"
          >
            <Edit3 className="w-3.5 h-3.5 text-purple-300" />
            <span>Sửa</span>
          </button>

          <div className="w-px h-3.5 bg-white/20" />

          <button
            type="button"
            onClick={() => {
              onOpenNote(selectionInfo);
              window.getSelection()?.removeAllRanges();
              setSelectionInfo(null);
            }}
            className="flex-1 min-h-12 flex justify-center items-center gap-2 px-4 py-3 rounded-xl hover:bg-white/20 text-sm font-semibold transition"
          >
            <MessageSquare className="w-3.5 h-3.5 text-amber-300" />
            <span>Ghi chú</span>
          </button>
        </div>
      )}
    </div>
  );
};

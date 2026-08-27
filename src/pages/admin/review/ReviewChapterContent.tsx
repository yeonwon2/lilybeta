import React from 'react';
import type { ChapterReviewDetailResponse, DerivedReviewStatus } from '../../../beta-review/reviewTypes';
import { applyEditsToParagraph } from '../../../beta-edit/applyEdits';

export interface ReviewChapterContentProps {
  chapterData: ChapterReviewDetailResponse;
  contentLayer: 'working' | 'approved' | 'original';
  selectedEdit: { id: string } | null;
  onSelectEdit: (edit: any) => void;
}

export const ReviewChapterContent = ({ chapterData, contentLayer, selectedEdit, onSelectEdit }: ReviewChapterContentProps) => (
  <article className="max-w-3xl mx-auto font-serif text-[17px] sm:text-[18px] text-[#2C2724] leading-[1.8] space-y-6">
    <h2 className="font-sans font-bold text-xl sm:text-2xl text-ink-900 pb-4 border-b border-ink-100">
      {chapterData.chapter.title}
    </h2>

    {/* LAYER 1: WORKING VERSION (Bản Beta) */}
    {contentLayer === 'working' &&
      chapterData.chapter.originalParagraphs.map((pText, pIdx) => {
        const paraEdits = chapterData.edits.filter(
          (e) => e.paragraphIndex === pIdx && e.status === 'ACTIVE'
        );

        const segments = applyEditsToParagraph(pText, paraEdits);

        return (
          <p key={pIdx} className="relative">
            {segments.map((seg, sIdx) => {
              if (!seg.isEdited || !seg.edit) {
                return <React.Fragment key={sIdx}>{seg.text}</React.Fragment>;
              }

              const edit = seg.edit as any;
              const isSelected = selectedEdit?.id === edit.id;
              const revStatus: DerivedReviewStatus = edit.derivedReviewStatus || edit.reviewStatus || 'PENDING';

              let highlightClass = 'bg-purple-100/80 border-purple-400 text-purple-950';
              let dotColor = 'bg-purple-500';

              if (revStatus === 'ACCEPTED') {
                highlightClass = 'bg-emerald-100/80 border-emerald-500 text-emerald-950';
                dotColor = 'bg-emerald-600';
              } else if (revStatus === 'CHANGES_REQUESTED') {
                highlightClass = 'bg-amber-100/90 border-amber-500 text-amber-950';
                dotColor = 'bg-amber-500';
              } else if (revStatus === 'REJECTED') {
                highlightClass = 'bg-rose-100/60 border-rose-400 text-rose-900 line-through opacity-75';
                dotColor = 'bg-rose-500';
              }

              return (
                <span
                  key={edit.id || sIdx}
                  onClick={() => onSelectEdit(edit)}
                  className={`cursor-pointer px-1 py-0.5 rounded-lg border-b-2 font-medium transition select-text ${highlightClass} ${
                    isSelected ? 'ring-2 ring-purple-600 ring-offset-2' : 'hover:opacity-90'
                  }`}
                  title={`Chỉnh sửa: ${edit.originalText} → ${edit.currentText} [${revStatus}]`}
                >
                  {seg.text}
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${dotColor} ml-1 align-middle`}
                  />
                </span>
              );
            })}
          </p>
        );
      })}

    {/* LAYER 2: APPROVED VERSION (Bản duyệt chính thức) */}
    {contentLayer === 'approved' &&
      chapterData.approvedVersion.paragraphs.map((para, pIdx) => (
        <p key={pIdx}>
          {para.segments.map((seg, sIdx) => {
            if (!seg.isApprovedEdit) {
              return <React.Fragment key={sIdx}>{seg.text}</React.Fragment>;
            }
            return (
              <span
                key={sIdx}
                className="bg-emerald-50 text-emerald-950 px-1 py-0.5 rounded-md border-b-2 border-emerald-400 font-medium"
                title={`Chỉnh sửa đã phê duyệt (Revision ${seg.revisionNumber})`}
              >
                {seg.text}
              </span>
            );
          })}
        </p>
      ))}

    {/* LAYER 3: ORIGINAL (Nguyên tác) */}
    {contentLayer === 'original' &&
      chapterData.chapter.originalParagraphs.map((pText, pIdx) => (
        <p key={pIdx}>{pText}</p>
      ))}
  </article>
);

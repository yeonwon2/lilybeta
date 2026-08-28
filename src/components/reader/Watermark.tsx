import React from 'react';
import { useAuth } from '../../context/AuthContext';

export const Watermark: React.FC = () => {
  const { user } = useAuth();
  if (!user || user.role !== 'BETA_READER') return null;

  const label = `LilyBeta • ${user.username}`;

  return (
    <div aria-hidden="true" className="fixed inset-0 pointer-events-none z-[60] select-none reader-watermark overflow-hidden grid grid-cols-2 grid-rows-3 items-center justify-items-center gap-8">
      {Array.from({ length: 6 }, (_, index) => <span key={index} className="text-sm sm:text-base font-mono font-semibold -rotate-12 whitespace-nowrap" style={{ color: 'var(--reader-text)', opacity: 0.10 }}>{label}</span>)}
    </div>
  );
};

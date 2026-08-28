// Deterrence only: readable browser content cannot be made impossible to extract.
export function isWritableField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const field = target.closest('input, textarea, [contenteditable]');
  if (!field) return false;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return !field.readOnly && !field.disabled;
  return field instanceof HTMLElement && field.isContentEditable;
}

export function blockManuscriptTransfer(event: { target: EventTarget | null; preventDefault(): void }, enabled: boolean): void {
  // Authors must still be able to copy/cut their own proposed text and notes.
  if (enabled && !isWritableField(event.target)) event.preventDefault();
}

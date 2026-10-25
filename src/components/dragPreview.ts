// Carry only Tooku data: links and image URLs would invite browser-level drop actions.
export function startInternalDrag(transfer: DataTransfer, mime: string, value: string, label: string) {
  transfer.clearData?.();
  transfer.setData(mime, value); transfer.effectAllowed = 'move';
  if (!transfer.setDragImage) return () => {};
  const preview = document.createElement('div');
  preview.className = 'compact-drag-preview'; preview.textContent = label;
  preview.setAttribute('aria-hidden', 'true'); document.body.append(preview);
  transfer.setDragImage(preview, 12, 16);
  const frame = requestAnimationFrame(() => preview.remove());
  return () => { cancelAnimationFrame(frame); preview.remove(); };
}

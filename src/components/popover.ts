// A trigger can disappear while a portal is being committed (route/modal close).
// Native top-layer failures must not tear down the React workspace.
export function revealPopover(node: HTMLElement): boolean {
  const dialog = node.closest('dialog');
  if (!node.isConnected || dialog && !dialog.open) return false;
  if (typeof node.showPopover !== 'function') { node.removeAttribute('popover'); return true; }
  try { node.showPopover(); return true; }
  catch (error) {
    if (!(error instanceof DOMException) || !['InvalidStateError', 'NotSupportedError'].includes(error.name)) throw error;
    node.removeAttribute('popover');
    return true;
  }
}

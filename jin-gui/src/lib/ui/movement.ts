/** Suppress collateral document selection only while a real move is active. */
let active = 0;
let previousUserSelect = '';
let previousWebkitUserSelect = '';
let previousMovingAttribute: string | null = null;

export function beginMovementSelection(owner: HTMLElement): () => void {
  if (active++ === 0) {
    const root = document.documentElement;
    previousUserSelect = root.style.userSelect;
    previousWebkitUserSelect = root.style.webkitUserSelect;
    previousMovingAttribute = root.getAttribute('data-jin-moving');
    document.getSelection()?.removeAllRanges();
    root.setAttribute('data-jin-moving', 'true');
    root.style.userSelect = 'none';
    root.style.webkitUserSelect = 'none';
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    window.removeEventListener('blur', release);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('dragend', release, true);
    document.removeEventListener('drop', release, true);
    document.removeEventListener('pointercancel', release, true);
    document.removeEventListener('pointerup', release, true);
    owner.removeEventListener('lostpointercapture', release);
    owner.removeEventListener('dragend', release);
    observer.disconnect();
    if (--active === 0) {
      document.documentElement.style.userSelect = previousUserSelect;
      document.documentElement.style.webkitUserSelect = previousWebkitUserSelect;
      if (previousMovingAttribute === null) document.documentElement.removeAttribute('data-jin-moving');
      else document.documentElement.setAttribute('data-jin-moving', previousMovingAttribute);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') release(); };
  const observer = new MutationObserver(() => { if (!owner.isConnected) release(); });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('blur', release);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('dragend', release, true);
  document.addEventListener('drop', release, true);
  document.addEventListener('pointercancel', release, true);
  document.addEventListener('pointerup', release, true);
  owner.addEventListener('lostpointercapture', release);
  return release;
}

/** Native drag releases on dragend/drop even if the source is replaced. */
export function guardNativeDrag(owner: HTMLElement): void {
  const release = beginMovementSelection(owner);
  owner.addEventListener('dragend', release, { once: true });
  // Some native WebViews cancel dragstart before dragend can fire.
  queueMicrotask(() => { if (!owner.isConnected) release(); });
}

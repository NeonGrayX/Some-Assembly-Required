/**
 * The loading screen in index.html: up from the first paint, so nobody sees the menu over an
 * empty page while the game loads. Each step lights more of the brick's studs; once the first picture of
 * the world is on screen, it fades out and the menu (or wherever the page opened) is there.
 */
const el = document.getElementById('loading');
let step = Number(el?.dataset.step ?? 1);

/** Says what is loading now, one stud further on. */
export function loadingStep(text: string): void {
  if (!el) return;
  el.dataset.step = String(++step);
  const line = el.querySelector('.loading-step');
  if (line) line.textContent = text;
}

/** The world has been drawn: fades the loading screen out. Safe to call every frame. */
export function loadingDone(): void {
  if (!el || el.dataset.step === 'done') return;
  el.dataset.step = 'done';
  // One more frame, so what was just drawn is on screen before the curtain lifts.
  requestAnimationFrame(() => {
    document.body.classList.remove('booting');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    // No transition (reduced motion): gone at once.
    setTimeout(() => el.remove(), 600);
  });
}

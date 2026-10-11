/**
 * Writes for what the game updates every frame, made only when something changes: writing the
 * same text again still replaces it, and the browser then works out the page's styles and
 * layout again before the next frame.
 */

/** Sets an element's text, if it is not that already. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Sets an element's classes, if they are not those already. */
export function setClassName(el: Element, name: string): void {
  if (el.className !== name) el.className = name;
}

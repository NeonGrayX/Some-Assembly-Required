/**
 * Hints and notices name the controls to use: a mouse button or a key at a computer, the button
 * on screen that does the same on a touch screen. They are written as parts naming each control,
 * so one hint reads right with either, in the words of the controls in use.
 */

/** A control a hint names (see the tables below for how each is said). */
export type NamedControl =
  /** A click, as a label ("Click: pick up"). */
  | 'use'
  /** A click, as a verb in the middle of a sentence ("click a rubbish bin"). */
  | 'click'
  | 'holdUse'
  | 'holdTheClick'
  | 'pull'
  | 'careful'
  | 'carefulUse'
  | 'rotate'
  | 'drop'
  | 'throw'
  | 'read'
  /** The saboteur's tamper tool. */
  | 'tamper';

/** A control: a named one, or a number key for the gear in a gear hunt. */
export type Control = NamedControl | { gear: number };

/**
 * One part of a hint: plain words, a control and what it does ("G: drop"), or a sentence with a
 * control in it (`before` + the control + `after`).
 */
export type HintPart =
  string | { control: Control; text: string } | { before: string; control: Control; after: string };

/** A hint or notice, its parts shown side by side. */
export type Hint = readonly HintPart[];

/** How each control is said: its word or key, as a label (or verb) in a hint. */
export type Labels = Record<NamedControl, string> & { gear: (n: number) => string };

/** With a mouse and keyboard. */
export const KEY_LABELS: Labels = {
  use: 'Click',
  click: 'click',
  holdUse: 'Hold click',
  holdTheClick: 'Hold the click',
  pull: 'Right click',
  careful: 'Hold Ctrl',
  carefulUse: 'Hold Ctrl and click',
  rotate: 'R',
  drop: 'G',
  throw: 'T',
  read: 'Q',
  tamper: '5',
  gear: (n) => String(n),
};

/**
 * On a touch screen: the buttons on screen (index.html's #touch), and the rows of the tools or
 * gear list for the number keys. `use` is what the Use button says now (Place while holding
 * something). A tap on the game does what a click does, so a click in a sentence is a tap.
 */
export function touchLabels(use: string): Labels {
  return {
    use,
    click: 'tap',
    holdUse: `Hold ${use}`,
    holdTheClick: `Hold ${use}`,
    pull: 'Pull',
    careful: 'Turn on Careful',
    carefulUse: `Turn on Careful, then ${use}`,
    rotate: 'Rotate',
    drop: 'Drop',
    throw: 'Throw',
    read: 'Read',
    tamper: 'Tool 5',
    gear: (n) => `Gear ${n}`,
  };
}

/** Puts a hint into words for the controls `labels` names. */
export function sayHint(hint: Hint, labels: Labels): string {
  const label = (c: Control) => (typeof c === 'string' ? labels[c] : labels.gear(c.gear));
  return hint
    .map((part) => {
      if (typeof part === 'string') return part;
      const name = label(part.control);
      if ('before' in part) return `${part.before}${name}${part.after}`;
      // A button named for what it does says it all ("Drop", not "Drop: drop").
      return part.text === name.toLowerCase() ? name : `${name}: ${part.text}`;
    })
    .join(' · ');
}

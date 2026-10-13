/**
 * What bots make of the text chat, without a language model: a handful of patterns for the things
 * players say most in a round (who did it, who is fine, where a page is, what to do), in English
 * and a little German. Anything else is small talk the bots let pass.
 */

/** A tell a player can claim to have seen. */
export type Deed = 'swap' | 'forge' | 'hide' | 'trip' | 'trap' | 'tamper';

/** A job a player can ask a bot to do. */
export type Errand = 'dog' | 'panel' | 'search' | 'come' | 'bell';

export type Heard =
  /** "I saw Bob swap a brick", "Bob is the saboteur". */
  | { kind: 'accuse'; target: number; deed?: Deed }
  /** "Bob is fine", "trust Bob". */
  | { kind: 'clear'; target: number }
  /** "vote Bob", "kick Bob". */
  | { kind: 'vote'; target: number }
  | { kind: 'skip' }
  /** "who is it?", "what are you doing?", "which stamp is real?". */
  | { kind: 'ask'; about: 'suspect' | 'doing' | 'stamp' }
  /** "where is page 5?" (step counts from 0, as pages do inside the game). */
  | { kind: 'page'; step: number; half?: 'A' | 'B' }
  /** "feed the dog", "come here". */
  | { kind: 'errand'; errand: Errand }
  | { kind: 'greet' };

export interface Said {
  /** The player spoken to by name ("Bob, …", "@Bob"), if any. */
  to: number | null;
  heard: Heard[];
}

export interface Named {
  id: number;
  name: string;
}

const DEEDS: [RegExp, Deed][] = [
  [/\b(tamper\w*|jam(s|med|ming)?|cut the power|manipulier\w*)\b/, 'tamper'],
  [/\b(swap|swaps|swapped|swapping|switch(ed|ing)?|tausch\w*)\b/, 'swap'],
  [/\b(forge|forges|forged|forging|forgery|fake[ds]?|fälsch\w*)\b/, 'forge'],
  [/\b(hide|hides|hid|hidden|hiding|stole|steal(s|ing)?|took|versteck\w*)\b/, 'hide'],
  [/\b(trip|trips|tripped|tripping|knock(ed|s)?|smash(ed)?|broke|wreck(ed)?)\b/, 'trip'],
  [/\b(drop|drops|dropped|dropping|trap|traps|spill(ed)?)\b/, 'trap'],
];

const GUILTY =
  /\b(sab|sabo|saboteur|sus|sussy|suspicious|lying|liar|impostor|imposter|traitor|verräter|lügt|did it|war es|was it)\b/;
const INNOCENT =
  /\b(innocent|clean|safe|fine|cleared|good|legit|not sus|not the sab\w*|not a sab\w*|kein sab\w*|unschuldig|with me|didn'?t do it|did not do it)\b/;
const QUESTION = /\?|\b(where|who|wo|wer)\b/;

const lower = (s: string) => s.toLowerCase().normalize('NFKC');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where each player is mentioned in `text` (by whole name, or by a word of it of 3+ letters). */
function mentions(text: string, players: Named[]): { id: number; at: number; len: number }[] {
  const found: { id: number; at: number; len: number }[] = [];
  // Words of names that name one player only.
  const words = new Map<string, number>();
  for (const p of players) {
    for (const w of lower(p.name).split(/\s+/)) {
      if (w.length >= 3) words.set(w, words.has(w) && words.get(w) !== p.id ? -1 : p.id);
    }
  }
  for (const p of players) {
    const whole = lower(p.name).trim();
    const names = new Set([whole]);
    for (const w of whole.split(/\s+/)) if (words.get(w) === p.id) names.add(w);
    for (const name of names) {
      if (!name) continue;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])@?(${escape(name)})(?=$|[^\\p{L}\\p{N}])`, 'gu');
      for (const m of text.matchAll(re)) {
        found.push({ id: p.id, at: m.index + m[1]!.length, len: m[0].length - m[1]!.length });
      }
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** Reads a chat line from player `from`. */
export function parse(raw: string, from: number, players: Named[]): Said {
  const text = lower(raw);
  const heard: Heard[] = [];
  const named = mentions(text, players).filter((m) => m.id !== from);
  // Spoken to: a name at the very start ("Bob, where is…") or an @name anywhere.
  let to: number | null = null;
  const first = named[0];
  if (
    first &&
    /^\s*((hey|hi|ok|okay|yo)\s+)?$/.test(text.slice(0, first.at)) &&
    /^\s*[,:!]/.test(text.slice(first.at + first.len))
  )
    to = first.id;
  const at = named.find((m) => text[m.at] === '@');
  if (at) to = at.id;
  // Whoever the line is about: the first name that is not the one spoken to.
  const about = named.find((m) => m.id !== to)?.id ?? null;
  const rest = to === null ? text : text.replace(/^[^,:]*[,:]/, ' ');

  const deed = DEEDS.find(([re]) => re.test(text))?.[1];
  if (about !== null) {
    if (/\b(vote|voting|kick|eject|rauswählen|raus)\b/.test(text)) {
      heard.push({ kind: 'vote', target: about });
    } else if (INNOCENT.test(text) || /\b(trust|vouch|vertrau\w*)\b/.test(text)) {
      if (!/\b(don'?t|do not|never|nicht)\s+(trust|vertrau)/.test(text))
        heard.push({ kind: 'clear', target: about });
      else heard.push({ kind: 'accuse', target: about });
    } else if (deed || GUILTY.test(text) || /\b(it'?s|its|it is|es ist|ist es)\b/.test(text)) {
      heard.push(
        deed ? { kind: 'accuse', target: about, deed } : { kind: 'accuse', target: about },
      );
    }
  } else if (to !== null && /\b(you|du)\b/.test(rest) && (deed || GUILTY.test(rest))) {
    // "Bob, you swapped that!"
    heard.push(deed ? { kind: 'accuse', target: to, deed } : { kind: 'accuse', target: to });
  } else if (/^\s*(skip|überspringen)\b/.test(text)) {
    heard.push({ kind: 'skip' });
  }

  const page = /\b(?:page|seite|p\.?)\s*#?\s*(\d{1,2})\s*([ab])?\b/.exec(text);
  if (page && QUESTION.test(text)) {
    const step = Number(page[1]) - 1;
    if (step >= 0) {
      const half = page[2]?.toUpperCase() as 'A' | 'B' | undefined;
      heard.push(half ? { kind: 'page', step, half } : { kind: 'page', step });
    }
  } else if (/\bmaster index\b|\bindex\b/.test(text) && QUESTION.test(text)) {
    heard.push({ kind: 'page', step: -1 });
  }
  if (
    /\b(who|wer)\b.*\b(sab\w*|sus|it|suspect|did|think|war)\b|\bany (suspects|ideas)\b|\bsuspects?\s*\?/.test(
      text,
    ) &&
    !heard.some((h) => h.kind === 'accuse' || h.kind === 'clear')
  ) {
    heard.push({ kind: 'ask', about: 'suspect' });
  }
  if (/\b(what are you doing|what r u doing|wyd|what('?s| is) your job|was machst du)\b/.test(text))
    heard.push({ kind: 'ask', about: 'doing' });
  if (/\bstamp\b.*\?|\b(which|real|right) stamp\b|\bstempel\b/.test(text))
    heard.push({ kind: 'ask', about: 'stamp' });

  if (/\b(feed|füttern?)\b.*\b(dog|hund)\b|\b(dog|hund)\b.*\b(treat|feed|füttern?)\b/.test(text))
    heard.push({ kind: 'errand', errand: 'dog' });
  if (/\b(fix|repair|turn on|reparier\w*)\b.*\b(panel|power|lights?|fuse|strom|licht)\b/.test(text))
    heard.push({ kind: 'errand', errand: 'panel' });
  if (/\b(find|search|look for|hunt|such\w*)\b.*\b(pages?|manual|seiten?)\b/.test(text))
    heard.push({ kind: 'errand', errand: 'search' });
  if (
    /\b(come here|over here|follow me|come with me|help me|komm( mal)? her|hilf mir)\b/.test(text)
  )
    heard.push({ kind: 'errand', errand: 'come' });
  if (/\b(ring|call|press)\b.*\b(bell|meeting)\b|\bglocke\b/.test(text))
    heard.push({ kind: 'errand', errand: 'bell' });
  if (!heard.length && /^\s*(hi|hey|hello|hallo|moin|servus|yo|sup)\b/.test(text))
    heard.push({ kind: 'greet' });
  return { to, heard };
}

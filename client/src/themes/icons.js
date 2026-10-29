// The shared UI icon set (docs/README.md §3, *UI icons*): one stroke set for all chrome and
// every product's tools - 24×24 viewBox, currentColor, 1.8 px stroke, drawn by base.css `.ico`.
// Every arrow-lab.de app copies this file unchanged, like sync.js. **Every icon an app shows
// comes from here**: no app draws its own, keeps a map of its own or puts an emoji or a text
// glyph (✓ ✕ ▲ ⌫ ⚙) where an icon belongs. An icon an app needs and this set lacks is drawn
// here first, in this hand, and copied to all of them. What stays in a product is its art:
// a board, a piece, a card, a device's panel, and the pictogram of an entry on its home list.
// The Icons page of the style guide shows every one.
//
//   ico('undo')                  -> '<svg class="ico" …>…</svg>' (a string, for innerHTML)
//   ico('trophy', 'ico big')     -> the same with other classes
//   icon('undo')                 -> the same as an SVGElement, for code that builds nodes
//   ICONS                        -> the map, name -> the SVG's inner markup
const FILE = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z';
const SLASH = '<path d="M3 3l18 18"/>';
const CORNERS = '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>';
const CAMERA = '<path d="M4 7.5h3l2-3h6l2 3h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>';
const VIDEO = '<rect x="2.5" y="6" width="13.5" height="12" rx="2"/><path d="M16 10.5l5.5-3v9l-5.5-3z"/>';
const LINK = '<path d="M10 14a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-6-.5l-2 2a4 4 0 0 0 5.7 5.7l1-1"/>';
const FLAG = '<path d="M5 22V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>';
const FLASH = '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>';
const RESTART = '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>';
const DISPLAY = '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10.5h10M7 13.5h6"/>';
export const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
  'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  hint: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  notes: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/>',
  erase: '<path d="M7 21h13"/><path d="M5.5 16.5l9.9-9.9a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L11 19H8z"/><path d="M10 12l4 4"/>',
  backspace: '<path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9l-6 6M11 9l6 6"/>',
  new: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  restart: RESTART,
  rules: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  install: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a4 4 0 0 1-3.2 3.9M7 5H4v2a4 4 0 0 0 3.2 3.9"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
  flag: FLAG,
  pass: '<path d="M5 12h12M13 7l5 5-5 5"/><path d="M20 5v14"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6M8 11h6"/>',
  cloud: '<path d="M7 19h10.5a4.5 4.5 0 0 0 .5-8.97A6.5 6.5 0 0 0 5.5 9.6 4.75 4.75 0 0 0 7 19z"/>',
  'cloud-off': '<path d="M7 19h10.5a4.5 4.5 0 0 0 .5-8.97A6.5 6.5 0 0 0 5.5 9.6 4.75 4.75 0 0 0 7 19z"/><path d="M3 3l18 18"/>',
  offline: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/><path d="M12 19h.01"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>',
  docs: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  themes: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  link: LINK,
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  filter: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
  inbox: '<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h5a3 3 0 0 0 6 0h5"/>',
  send: '<path d="M21 3L10.6 13.4"/><path d="M21 3l-6.4 18-4-7.6L3 9.4z"/>',
  attach: '<path d="M20.5 11.3l-8.4 8.4a5.3 5.3 0 0 1-7.5-7.5l8.4-8.4a3.5 3.5 0 0 1 5 5l-8.4 8.4a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8"/>',
  download: '<path d="M12 3.5v11.5M7 10.5l5 5 5-5"/><path d="M4 16.5V20h16v-3.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 15.5l-5-5L6.5 20"/>',
  video: VIDEO,
  music: '<path d="M9 17.5V5.5l11-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  camera: CAMERA,
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.2"/><path d="M10.5 18.5h3"/>',
  tablet: '<rect x="4" y="3" width="16" height="18" rx="2.2"/><path d="M10.5 18h3"/>',
  computer: '<rect x="2.5" y="4" width="19" height="12.5" rx="1.6"/><path d="M8 20.5h8M12 16.5v4"/>',

  // Moving through a page
  forward: '<path d="M9 5l7 7-7 7"/>',
  'chevron-up': '<path d="M6 15l6-6 6 6"/>',
  'left-right': '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  swap: '<path d="M4 8h15M15 4l4 4-4 4"/><path d="M20 16H5M9 12l-4 4 4 4"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>',
  'rotate-left': RESTART,
  'rotate-right': '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  enter: '<path d="M20 5v6a3 3 0 0 1-3 3H5"/><path d="M9 10l-4 4 4 4"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',

  // Doing things
  upload: '<path d="M12 15.5V4M7 9l5-5 5 5"/><path d="M4 16.5V20h16v-3.5"/>',
  'file-upload': `<path d="${FILE}"/><path d="M14 3v5h5M12 18v-6M9.5 14.5L12 12l2.5 2.5"/>`,
  save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5L20 18M8.5 16.5L20 6"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  'link-off': LINK + SLASH,
  'flag-off': FLAG + SLASH,
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M8 11h6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  'fast-forward': '<path d="M3.5 6l8 6-8 6zM12.5 6l8 6-8 6z"/>',
  rewind: '<path d="M20.5 6l-8 6 8 6zM11.5 6l-8 6 8 6z"/>',
  power: '<path d="M12 3v8"/><path d="M7 6.3a7.5 7.5 0 1 0 10 0"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  'bookmark-add': '<path d="M13 3H6v18l6-4 6 4V10"/><path d="M18 2v6M15 5h6"/>',
  'auto-fix': '<path d="M4 20l11-11"/><path d="M16 3v4M14 5h4M20 9v4M18 11h4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  tune: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/><path d="M12 7.5V12l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  'lock-open': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7"/>',
  shield: '<path d="M12 3l7 3v5c0 4.6-3 8-7 10-4-2-7-5.4-7-10V6z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v6M17 10a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-5-2.7l-3-4.6a1.5 1.5 0 0 1 2.5-1.7L8 14"/>',
  target: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  'dots-grid': '<circle cx="5" cy="5" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="19" cy="5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="19" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="19" cy="19" r="1"/>',
  fill: '<rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor"/>',
  half: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  speed: '<path d="M5 12h9M5 7h6M5 17h6"/><path d="M14 6l6 6-6 6"/>',
  road: '<path d="M8 20L10.5 4M16 20L13.5 4M12 7v2M12 12v2M12 17v2"/>',
  'trend-up': '<path d="M4 17l5-5 4 4 7-7"/><path d="M15 9h5v5"/>',
  chart: '<path d="M4 4v16h16"/><path d="M7.5 15l3.5-4 3 2.5 5-6"/>',

  // What a thing is
  text: '<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>',
  title: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  'edit-note': '<path d="M4 6h10M4 10h10M4 14h6"/><path d="M14 20h2.5l5-5-2.5-2.5-5 5z"/>',
  list: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7.5 9h.01M7.5 12h.01M7.5 15h.01M10.5 9h6M10.5 12h6M10.5 15h6"/>',
  checklist: '<path d="M4 6.5l1.5 1.5 3-3M4 13.5l1.5 1.5 3-3"/><path d="M11.5 7h8.5M11.5 14h8.5M11.5 20h8.5M5 20h2"/>',
  contact: `<path d="${FILE}"/><path d="M14 3v5h5"/><circle cx="12" cy="12.5" r="2"/><path d="M8.5 18a3.5 3.5 0 0 1 7 0"/>`,
  badge: '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="8.5" cy="11.5" r="2"/><path d="M5.5 16.5a3 3 0 0 1 6 0M14 11h4M14 14h3"/>',
  'person-add': '<circle cx="9" cy="8" r="4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
  chat: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>',
  call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
  heart: '<path d="M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.4 12 20 12 20z"/>',
  place: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M14 14h3v3h-3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cart: '<path d="M2.5 4h2.6l2.5 10.5h10.2l2.2-7.5H6.2"/><circle cx="9" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
  parcel: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9M7.8 5.3l8.4 4.5"/>',
  suitcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M8 7v13M16 7v13"/>',
  gamepad: '<path d="M7 7h10a4 4 0 0 1 3.9 4.9l-1.1 4.8a2.4 2.4 0 0 1-4.1 1.1L13.8 16h-3.6l-1.9 1.8a2.4 2.4 0 0 1-4.1-1.1l-1.1-4.8A4 4 0 0 1 7 7z"/><path d="M8 10.5v3M6.5 12h3M15.5 11h.01M17.5 13h.01"/>',
  glass: '<path d="M4 4h16l-8 9z"/><path d="M12 13v7M8 20h8"/>',
  display: DISPLAY,
  'display-off': DISPLAY + SLASH,
  'aspect-ratio': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 12V9h3M17 12v3h-3"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8z"/><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01"/>',
  'border-style': '<path d="M4 20V5a1 1 0 0 1 1-1h15"/><path d="M8 20h.01M12 20h.01M16 20h.01M20 20h.01M20 16h.01M20 12h.01M20 8h.01"/>',
  shapes: '<circle cx="8" cy="8" r="4.5"/><rect x="12" y="12" width="8.5" height="8.5" rx="1"/>',

  // Codes and the camera
  'qr-code': '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2.5v2.5M20 14v.01M14 20h.01M17 20h3v-3"/>',
  'qr-scan': `${CORNERS}<path d="M4 12h16"/>`,
  barcode: '<path d="M3 5v14M6 5v14M9.5 5v14M12.5 5v10M15.5 5v14M18 5v10M21 5v14"/>',
  'scan-doc': `${CORNERS}<path d="M8.5 9h7M8.5 12h7M8.5 15h4"/>`,
  'camera-off': CAMERA + SLASH,
  'video-off': VIDEO + SLASH,
  flash: FLASH,
  'flash-off': FLASH + SLASH,
  vibrate: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4.5 8v8M19.5 8v8"/>',

  // How something went
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  block: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',

  // Weather, heat and water
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  snowflake: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>',
  thermometer: '<path d="M10 14.3V5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><path d="M12 9v8"/>',
  flame: '<path d="M12 2.5c2 4 6 6 6 11a6 6 0 1 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z"/>',
  droplet: '<path d="M12 3.5c3 4 6.5 7.5 6.5 11a6.5 6.5 0 0 1-13 0c0-3.5 3.5-7 6.5-11z"/>',
  waves: '<path d="M3 9c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0M3 15c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h6"/>',
  tap: '<path d="M3 8.5h11.5A4.5 4.5 0 0 1 19 13v1.5h-4a2 2 0 0 0-2-2H3"/><path d="M9 8.5V5M6.5 5h5"/><path d="M17 18v.01M17 21v.01"/>',
  shower: '<path d="M5 21V8a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4"/><path d="M11 8h8"/><path d="M12 11.5v.01M15 11.5v.01M18 11.5v.01M13.5 14.5v.01M16.5 14.5v.01M12 17.5v.01M15 17.5v.01M18 17.5v.01"/>',
  tank: '<rect x="6" y="3" width="12" height="18" rx="5"/><path d="M6 9h12M6 15h12"/>',
  valve: '<path d="M4 9v6l8-3zM20 9v6l-8-3z"/><path d="M12 12V6M9 6h6"/>',
  sponge: '<rect x="3.5" y="10" width="17" height="10" rx="2.5"/><path d="M8 14h.01M12 16.5h.01M16 14h.01"/><circle cx="8" cy="5.5" r="1.5"/><circle cx="13.5" cy="4.5" r="1"/><circle cx="17" cy="7" r="1.2"/>',
  pump: '<circle cx="11" cy="13" r="7"/><circle cx="11" cy="13" r="2"/><path d="M11 6h10v4h-4.2"/><path d="M7 20l-1.5 2h11L15 20"/>',
  leaf: '<path d="M5 20C5 11 10 5 20 5c0 10-6 15-15 15z"/><path d="M5 20l8-8"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
};

export const ico = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

export function icon(name, cls = 'ico') {
  const t = document.createElement('template');
  t.innerHTML = ico(name, cls);
  return t.content.firstChild;
}

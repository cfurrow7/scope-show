// phone/pages.js
//
// Turns a block of typed text into a page list: one line per page, with a
// rotating solid dropped between the pages. Kept apart from any particular
// player so the standalone show, the instrument and a shared link can all
// agree on what "this text, as pages" means.
//
// Pages are descriptions, not tables. Building the stroke table needs the font
// (text) or the clock (a solid, which changes every frame), and neither
// belongs in a pure text-to-pages function.

import { SUPPORTED_CHARS } from './hershey.js';

export const DEFAULT_HOLD = 3.2;
export const DEFAULT_SOLID_HOLD = 2.4;

// Roughly how many glyphs fit across the tube before the lettering gets too
// fine to read on a small screen. The font is a fixed design width per glyph,
// so this is a character count rather than a measurement.
const MAX_CHARS = 13;
const MAX_LINES = 2;

const SOLID_CYCLE = ['cube', 'pyramid'];

// A line that is just `*` marks where a shape goes, and turns the message into
// explicit mode (see paginate). `* square` picks the shape; a bare `*` takes
// the next spiral in the cycle.
const STAR = /^\*\s*([a-z]*)\s*$/i;
const STAR_CYCLE = ['triangle', 'square', 'circle', 'sun'];
// A poster line is a name, and a two-word name reads far better stacked and
// big than run together at the size thirteen characters forces.
const STAR_MAX_CHARS = 9;
// Traced artwork takes longer to draw than a spiral and deserves a look once
// it is complete, so those pages hold longer than the shape time.
const EXTRA_HOLD = { henry: 1.2, retrospects: 0.8, wave: 0.6 };
export const SHAPE_NAMES = ['triangle', 'square', 'circle', 'sun', 'henry', 'retrospects', 'mirrorball', 'wave', 'cube', 'pyramid'];

// unsupportedChars: which characters of a message the font has no glyph for.
// They do not break anything (textToStrokes silently draws a space), which is
// exactly why a caller wants to be told: a message that quietly loses its
// apostrophes is worth knowing about before it is on somebody else's scope.
export function unsupportedChars(text) {
  const seen = new Set();
  const body = String(text).split('\n').filter(line => !STAR.test(line.trim())).join('\n');
  for (const ch of body.toUpperCase()) {
    if (ch !== '\n' && !SUPPORTED_CHARS.includes(ch)) seen.add(ch);
  }
  return [...seen];
}

// wrapLine: a line too wide to read gets broken between words into at most
// MAX_LINES stacked lines, and anything still left over starts another page.
// Splitting mid-phrase across two pages is worse than two small lines on one,
// which is why stacking is tried first. A single word longer than the limit is
// left alone rather than hyphenated: the shape of the word survives, it just
// draws smaller.
export function wrapLine(line, maxChars = MAX_CHARS, maxLines = MAX_LINES) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const rows = [];
  let row = '';
  for (const word of words) {
    const candidate = row ? `${row} ${word}` : word;
    if (row && candidate.length > maxChars) {
      rows.push(row);
      row = word;
    } else {
      row = candidate;
    }
  }
  if (row) rows.push(row);

  const pages = [];
  for (let i = 0; i < rows.length; i += maxLines) {
    pages.push(rows.slice(i, i + maxLines).join('\n'));
  }
  return pages;
}

// paginate: the text block as it is typed, one page per line, with solids
// interleaved.
//
// opts.solids: 'alternate' (cube, pyramid, cube, ...), 'cube', 'pyramid', or
//   'none' for text only.
// opts.hold / opts.solidHold: seconds each kind of page holds before it starts
//   morphing into the next.
// opts.maxChars: characters per line before wrapping kicks in.
//
// A blank line in the input is not a page. It reads as a pause in the writing,
// so it keeps the solid that follows it and drops the empty page, which is
// what someone pasting a list with gaps in it means by it.
export function paginate(text, opts = {}) {
  const solids = opts.solids ?? 'alternate';
  const hold = opts.hold ?? DEFAULT_HOLD;
  const solidHold = opts.solidHold ?? DEFAULT_SOLID_HOLD;
  const maxChars = opts.maxChars ?? MAX_CHARS;

  const raw = String(text).split('\n');
  if (raw.some(line => STAR.test(line.trim()))) {
    return paginateStarred(raw, { hold, solidHold, maxChars: opts.maxChars ?? STAR_MAX_CHARS });
  }

  const lines = raw.flatMap(line => wrapLine(line, maxChars));
  const pages = [];
  let solidIndex = 0;
  lines.forEach((line, i) => {
    pages.push({ kind: 'text', text: line, hold });
    // No trailing solid: the show loops, so the last page's morph already
    // lands on the first page and an extra solid there would read as a stall
    // before the message restarts.
    if (solids !== 'none' && i < lines.length - 1) {
      const solid = solids === 'alternate'
        ? SOLID_CYCLE[solidIndex++ % SOLID_CYCLE.length]
        : solids;
      pages.push({ kind: 'solid', solid, hold: solidHold });
    }
  });
  return pages;
}

// paginateStarred: explicit mode, for a message that says where its shapes go.
// Every `*` line is a shape; the lines between two stars are one page, stacked
// (a two-line band name stays together), spilling onto further pages only past
// MAX_LINES rows. Stars at the very start or end are honoured too, since in
// this mode the shapes are what was asked for rather than a default.
function paginateStarred(raw, { hold, solidHold, maxChars }) {
  const pages = [];
  let rows = [];
  let cycle = 0;
  const flush = () => {
    for (let i = 0; i < rows.length; i += MAX_LINES) {
      pages.push({ kind: 'text', text: rows.slice(i, i + MAX_LINES).join('\n'), hold });
    }
    rows = [];
  };
  for (const line of raw) {
    const star = line.trim().match(STAR);
    if (!star) {
      rows.push(...wrapLine(line, maxChars).flatMap(page => page.split('\n')));
      continue;
    }
    flush();
    const named = star[1].toLowerCase();
    const solid = SHAPE_NAMES.includes(named)
      ? named
      : STAR_CYCLE[cycle++ % STAR_CYCLE.length];
    pages.push({ kind: 'solid', solid, hold: solidHold + (EXTRA_HOLD[solid] ?? 0) });
  }
  flush();
  return pages;
}

// --- Retrospects style ----------------------------------------------------
//
// The Retrospects can be drawn two ways: their script logo from the album
// art, or plain lettering. Both are just message lines, so
// switching is a rewrite of the message and the link carries the choice.

const isStar = (line, name) => {
  const m = line.trim().match(STAR);
  return Boolean(m) && (name === undefined || m[1].toLowerCase() === name);
};

// retroStyle: 'album', 'text', or null when the message has no Retrospects.
export function retroStyle(message) {
  const lines = String(message).split('\n');
  if (lines.some(l => isStar(l, 'retrospects'))) return 'album';
  if (lines.some(l => l.trim().toUpperCase() === 'RETROSPECTS')) return 'text';
  return null;
}

export function setRetroStyle(message, style) {
  return String(message).split('\n').map((line) => {
    if (style === 'text' && isStar(line, 'retrospects')) return 'RETROSPECTS';
    if (style === 'album' && line.trim().toUpperCase() === 'RETROSPECTS') return '* retrospects';
    return line;
  }).join('\n');
}

// Parses a Synergy-style GSC menu (menu_option() { switch(menu) { case "Name": self add_option(...); } }) into a tree.
// Nothing about the menu is hard coded: whatever the repo's script declares is what comes out.

const KINDS = { add_option: 'option', add_toggle: 'toggle', add_increment: 'increment', add_array: 'array' };

export const cleanText = text => String(text).replace(/\^[0-9]/g, '').replace(/\[\{\+?(\w+)\}\]/g, (_, key) => key.toUpperCase()).replace(/\s+/g, ' ').trim();

// Splits `a, "b, c", f(x, y)` on top-level commas.
export function splitArgs(source) {
  const out = [];
  let depth = 0, quote = false, last = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) { if (ch === '\\') i++; else if (ch === '"') quote = false; continue; }
    if (ch === '"') quote = true;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) { out.push(source.slice(last, i).trim()); last = i + 1; }
  }
  if (source.slice(last).trim()) out.push(source.slice(last).trim());
  return out;
}

// A literal ("text", 12, -0.5, true, undefined) -> value; a concatenation keeps its literal parts; anything else -> { expr }.
export function literal(arg) {
  const text = String(arg ?? '').trim();
  if (!text || text === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === 'true' || text === 'false') return text === 'true';
  const strings = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  if (strings.length && /^(?:"(?:[^"\\]|\\.)*"|\s*\+\s*|[\w.]+(?:\(.*?\))?)+$/.test(text) && text.startsWith('"') && !text.includes('(') || /^"(?:[^"\\]|\\.)*"$/.test(text)) {
    return strings.map(m => m[1]).join('');
  }
  if (strings.length) return { expr: text, partial: strings.map(m => m[1]).join('') };
  return { expr: text };
}

const command = arg => /^(?:&|::)\s*([\w:]+)/.exec(String(arg ?? '').trim())?.[1]?.split('::').pop();

// The array argument of add_array is usually a variable; inline `array("a","b")` lists are read when present.
const arrayValues = arg => {
  const m = /^array\s*\((.*)\)$/s.exec(String(arg ?? '').trim());
  return m ? splitArgs(m[1]).map(literal).filter(v => v !== undefined && typeof v !== 'object') : null;
};

function findBody(source, name) {
  const start = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  if (!start) return '';
  const open = source.indexOf('{', start.index);
  let depth = 0, quote = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) { if (ch === '\\') i++; else if (ch === '"') quote = false; continue; }
    if (ch === '"') quote = true;
    else if (ch === '/' && source[i + 1] === '/') i = source.indexOf('\n', i) - 1;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

// Joins a statement that was wrapped across lines.
function* statements(body) {
  let buffer = '';
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    buffer = buffer ? `${buffer} ${line}` : line;
    const open = (buffer.match(/\(/g) ?? []).length, close = (buffer.match(/\)/g) ?? []).length;
    if (open <= close || !/^self add_/.test(buffer)) { yield buffer; buffer = ''; }
  }
  if (buffer) yield buffer;
}

export function parseGscMenu(source, { entry = 'menu_option', root = null } = {}) {
  const body = findBody(String(source), entry);
  const menus = new Map();
  let current = null;
  for (const line of statements(body)) {
    const label = /^case\s+"([^"]+)"\s*:/.exec(line);
    if (label) { current = { name: label[1], items: [] }; menus.set(current.name, current); continue; }
    if (!current) continue;
    const call = /^(?:foreach\s*\([^)]*\)\s*|for\s*\([^)]*\)\s*|if\s*\([^)]*\)\s*)*self\s+(add_option|add_toggle|add_increment|add_array)\s*\((.*)\)\s*;?\s*\}?$/.exec(line);
    if (!call) continue;
    const kind = KINDS[call[1]];
    const args = splitArgs(call[2]);
    if (!args.length || /^\w+\(/.test(args[0])) continue; // add_option(empty_option())
    const text = literal(args[0]);
    const base = { kind, description: undefined, command: command(args[2]) };
    const description = literal(args[1]);
    if (typeof description === 'string') base.description = cleanText(description);
    if (kind === 'toggle') Object.assign(base, { state: args[3], params: args.slice(4).map(literal).filter(v => v !== undefined) });
    else if (kind === 'increment') Object.assign(base, { start: literal(args[3]), min: literal(args[4]), max: literal(args[5]), step: literal(args[6]), params: args.slice(7).map(literal).filter(v => v !== undefined) });
    else if (kind === 'array') Object.assign(base, { values: arrayValues(args[3]), params: args.slice(6).map(literal).filter(v => v !== undefined) });
    else base.params = args.slice(3).map(literal).filter(v => v !== undefined);
    if (typeof text === 'string') base.text = cleanText(text);
    else { base.text = cleanText(text?.partial ?? ''); base.dynamic = String(text?.expr ?? args[0]); }
    if (base.command === 'new_menu' && typeof base.params[0] === 'string') base.submenu = base.params[0];
    current.items.push(base);
  }
  const first = root ?? menus.keys().next().value ?? null;
  return { root: first, menus: Object.fromEntries(menus), commands: [...new Set([...menus.values()].flatMap(m => m.items.map(i => i.command)).filter(Boolean))] };
}

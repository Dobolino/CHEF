// JSON.parse deliberately accepts duplicate keys. Imports must not do so.
export function parseJSON(text, { maxBytes = 1024 * 1024 } = {}) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > maxBytes) {
    throw new Error('Die Datei darf höchstens 1 MB groß sein.');
  }
  let i = 0;
  const ws = () => { while (/[ \t\r\n]/.test(text[i] || '') && i < text.length) i++; };
  const fail = message => { throw new Error(`${message} (Zeichen ${i + 1}).`); };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') {
        try { return JSON.parse(text.slice(start, i)); } catch { fail('Ungültige Zeichenkette'); }
      }
    }
    fail('Nicht abgeschlossene Zeichenkette');
  }
  function value(depth = 0) {
    if (depth > 80) fail('Zu viele verschachtelte Ebenen');
    ws();
    if (text[i] === '"') return string();
    if (text[i] === '{') {
      i++; ws(); const result = Object.create(null), seen = new Set();
      if (text[i] === '}') { i++; return result; }
      while (i < text.length) {
        ws(); if (text[i] !== '"') fail('Ein Feldname fehlt');
        const key = string();
        if (seen.has(key)) fail(`Doppelter Feldname „${key}“`);
        seen.add(key); ws(); if (text[i++] !== ':') fail('Doppelpunkt fehlt');
        result[key] = value(depth + 1); ws();
        if (text[i] === '}') { i++; return result; }
        if (text[i++] !== ',') fail('Komma fehlt');
      }
      fail('Objekt nicht abgeschlossen');
    }
    if (text[i] === '[') {
      i++; ws(); const result = [];
      if (text[i] === ']') { i++; return result; }
      while (i < text.length) {
        result.push(value(depth + 1)); ws();
        if (text[i] === ']') { i++; return result; }
        if (text[i++] !== ',') fail('Komma fehlt');
      }
      fail('Liste nicht abgeschlossen');
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!match) fail('Ungültiger JSON-Wert');
    i += match[0].length;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed === 'number' && !Number.isFinite(parsed)) fail('Zahl außerhalb des unterstützten Bereichs');
    return parsed;
  }
  const result = value(); ws();
  if (i !== text.length) fail('Unerwarteter Inhalt nach dem JSON');
  return result;
}

export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJSON(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

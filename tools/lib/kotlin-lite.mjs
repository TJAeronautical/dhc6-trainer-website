/*
  Minimal Kotlin literal reader used by the content build.

  The Android app keeps some authored training content as Kotlin literals
  (data-class constructor calls with string / number / list arguments). This
  module reads those literals without a real Kotlin parser: it understands
  string literals (with escapes), nested parentheses/brackets/braces, line and
  block comments, `listOf(...)`/`setOf(...)`, numbers with the `f` suffix,
  booleans and dotted identifiers. Anything else is kept as `{ expr: "..." }`
  so the caller can decide how to handle it (and fail loudly if it must).
*/

export function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      if (source.startsWith('"""', i)) {
        const end = source.indexOf('"""', i + 3);
        out += source.slice(i, end + 3);
        i = end + 3;
        continue;
      }
      let j = i + 1;
      while (j < source.length && source[j] !== '"') {
        if (source[j] === "\\") j += 1;
        j += 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/* Index just past the bracket that closes the one at `openIndex`. */
export function balancedEnd(source, openIndex) {
  const open = source[openIndex];
  const close = open === "(" ? ")" : open === "[" ? "]" : "}";
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') {
        if (source[j] === "\\") j += 1;
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return source.length;
}

/* Split `a, b(c, d), "x,y"` on top-level commas. */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") j += 1;
        j += 1;
      }
      current += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
    i += 1;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function decodeString(literal) {
  const body = literal.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\") {
      const next = body[i + 1];
      out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

export function parseValue(raw) {
  const text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"')) return decodeString(text);
  const list = /^(listOf|setOf|mutableListOf|arrayOf)\(/.exec(text);
  if (list) {
    const end = balancedEnd(text, list[0].length - 1);
    return splitTopLevel(text.slice(list[0].length, end - 1)).map(parseValue);
  }
  if (/^(emptyList|emptySet|emptyMap)\(\)$/.test(text)) return [];
  if (/^-?\d+(\.\d+)?[fFL]?$/.test(text)) return Number(text.replace(/[fFL]$/, ""));
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(text)) return { ident: text };
  return { expr: text };
}

/*
  Parse the arguments of the call whose opening parenthesis is at `openIndex`.
  -> { args: [{ name|null, raw, value }], end }
*/
export function parseCallAt(source, openIndex) {
  const end = balancedEnd(source, openIndex);
  const inner = source.slice(openIndex + 1, end - 1);
  const args = splitTopLevel(inner).map((piece) => {
    const named = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*([\s\S]*)$/.exec(piece);
    if (named && !piece.trim().startsWith('"')) {
      return { name: named[1], raw: named[2].trim(), value: parseValue(named[2]) };
    }
    return { name: null, raw: piece, value: parseValue(piece) };
  });
  return { args: args, end: end };
}

/* Every `callName(...)` call in `source` (string-aware), in order. */
export function findCalls(source, callName) {
  const calls = [];
  const pattern = new RegExp("(?<![A-Za-z0-9_.])" + callName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\(", "g");
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    const parsed = parseCallAt(source, openIndex);
    calls.push({ index: match.index, openIndex: openIndex, end: parsed.end, args: parsed.args, text: source.slice(match.index, parsed.end) });
    pattern.lastIndex = parsed.end;
  }
  return calls;
}

export function argMap(call) {
  const map = {};
  call.args.forEach((arg, i) => { map[arg.name || String(i)] = arg.value; });
  return map;
}

export function argRaw(call, name) {
  const found = call.args.find((a) => a.name === name);
  return found ? found.raw : null;
}

/* Body text of `fun name(` … `}` (first matching top-level function). */
export function functionBody(source, name) {
  const match = new RegExp("fun\\s+" + name + "\\s*\\(").exec(source);
  if (!match) return null;
  const paramsEnd = balancedEnd(source, match.index + match[0].length - 1);
  const eq = source.indexOf("=", paramsEnd);
  const brace = source.indexOf("{", paramsEnd);
  if (eq !== -1 && (brace === -1 || eq < brace) && /^[\s:A-Za-z0-9_<>?]*=/.test(source.slice(paramsEnd, eq + 1))) {
    // expression body: `= when (...) { ... }` or `= "..."`
    const whenIndex = source.indexOf("when", eq);
    const open = source.indexOf("{", whenIndex);
    if (whenIndex !== -1 && open !== -1 && open - eq < 200) return source.slice(open + 1, balancedEnd(source, open) - 1);
    const lineEnd = source.indexOf("\n", eq);
    return source.slice(eq + 1, lineEnd === -1 ? source.length : lineEnd);
  }
  if (brace === -1) return null;
  return source.slice(brace + 1, balancedEnd(source, brace) - 1);
}

/* Value text after `val name = ` up to the end of its balanced expression. */
export function valDeclaration(source, name) {
  const match = new RegExp("val\\s+" + name + "\\s*(?::[^=]+)?=\\s*").exec(source);
  if (!match) return null;
  const start = match.index + match[0].length;
  const open = source.indexOf("(", start);
  if (open === -1 || open - start > 40) {
    const lineEnd = source.indexOf("\n", start);
    return source.slice(start, lineEnd === -1 ? source.length : lineEnd).trim();
  }
  return source.slice(start, balancedEnd(source, open)).trim();
}

/*
  Read a `when (x) { A, B -> value  C -> value  else -> value }` body into
  { cases: [{ keys:[...], raw }], elseRaw }. Case heads are enum references
  (`AircraftSystem.X`), string literals or `else`, optionally comma-separated
  and possibly spread over several lines; the value is everything up to the
  next case head.
*/
export function whenCases(body) {
  const headPattern = /(^|\n)[ \t]*((?:AircraftSystem\.[A-Z_0-9]+|"(?:[^"\\]|\\.)*"|else)(?:\s*,\s*(?:AircraftSystem\.[A-Z_0-9]+|"(?:[^"\\]|\\.)*"))*)\s*->/g;
  // nesting depth at every index (string-aware) so heads inside nested
  // `when { … }` / `build(…)` blocks are ignored
  const depthAt = new Int32Array(body.length + 1);
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    depthAt[i] = depth;
    const ch = body[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < body.length && body[j] !== '"') { if (body[j] === "\\") j += 1; j += 1; }
      for (let k = i; k <= j && k < body.length; k += 1) depthAt[k] = depth;
      i = j;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
  }
  depthAt[body.length] = depth;
  const heads = [];
  let match;
  while ((match = headPattern.exec(body)) !== null) {
    const headIndex = match.index + match[1].length;
    if (depthAt[headIndex] !== 0) continue;
    heads.push({ start: match.index, valueStart: match.index + match[0].length, keys: match[2] });
  }
  const cases = [];
  let elseRaw = null;
  heads.forEach((head, i) => {
    const valueEnd = i + 1 < heads.length ? heads[i + 1].start : body.length;
    const raw = body.slice(head.valueStart, valueEnd).trim();
    const keys = splitTopLevel(head.keys).map((k) => k.trim());
    if (keys.length === 1 && keys[0] === "else") elseRaw = raw;
    else cases.push({ keys: keys, raw: raw });
  });
  return { cases: cases, elseRaw: elseRaw };
}

export function enumKey(key) {
  return key.replace(/^AircraftSystem\./, "").replace(/^"|"$/g, "");
}

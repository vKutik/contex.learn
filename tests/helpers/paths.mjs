/* paths.mjs - where things are, and how to read the source of the app
 * without tripping over its own prose.
 *
 * Several deploy checks are grep-shaped: "does anything outside storage.js
 * touch localStorage", "is there a stray console.log". A naive grep over this
 * repository answers wrongly, because js/data/passages.js is a thousand
 * sentences of English and contains the words "window" and "console" inside
 * quoted text. So the checks run over `codeOnly()`, which blanks comments and
 * string literals first and leaves the code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const abs  = (...p) => path.join(ROOT, ...p);
export const rel  = p => path.relative(ROOT, p);
export const read = (...p) => fs.readFileSync(abs(...p), 'utf8');
export const exists = (...p) => fs.existsSync(abs(...p));

/** Every .js file the browser can load, deepest last. */
export function appFiles(dir = 'js'){
  const out = [];
  (function walk(d){
    for(const e of fs.readdirSync(d, { withFileTypes:true }).sort((a,b)=>a.name<b.name?-1:1)){
      const p = path.join(d, e.name);
      if(e.isDirectory()) walk(p);
      else if(e.name.endsWith('.js')) out.push(p);
    }
  })(abs(dir));
  return out;
}

/**
 * The same source with every comment and string literal blanked out, so a
 * regex sees code and only code. Newlines are kept, so a match still reports
 * the line it was on.
 *
 * Template literals keep their `${...}` holes, because in this codebase those
 * holes are where most of the code lives - every screen is a template - and
 * blanking them would hide half the app from these checks.
 */
export function codeOnly(src){
  let out = '', i = 0;
  const keep = c => { out += c === '\n' ? '\n' : ' '; };
  // a slash opens a regex literal only where a value cannot already have ended
  const regexOk = () => {
    for(let k = out.length - 1; k >= 0; k--){
      if(/\s/.test(out[k])) continue;
      return '(,=:[!&|?{};+-*%^~<>'.includes(out[k]);
    }
    return true;
  };

  while(i < src.length){
    const c = src[i], d = src[i+1];

    if(c === '/' && d === '/'){ while(i < src.length && src[i] !== '\n') keep(src[i++]); continue; }

    if(c === '/' && d === '*'){
      keep(src[i++]); keep(src[i++]);
      while(i < src.length && !(src[i] === '*' && src[i+1] === '/')) keep(src[i++]);
      if(i < src.length){ keep(src[i++]); keep(src[i++]); }
      continue;
    }

    if(c === '"' || c === "'"){
      out += c; i++;
      while(i < src.length && src[i] !== c && src[i] !== '\n'){
        if(src[i] === '\\') keep(src[i++]);
        keep(src[i++]);
      }
      out += src[i] ?? ''; i++;
      continue;
    }

    if(c === '`'){
      out += c; i++;
      let depth = 0;
      while(i < src.length){
        if(depth === 0 && src[i] === '`') break;
        if(depth === 0 && src[i] === '\\'){ keep(src[i++]); keep(src[i++]); continue; }
        if(depth === 0 && src[i] === '$' && src[i+1] === '{'){
          out += '${'; i += 2; depth = 1;
          // copy the hole through verbatim, tracking nested braces
          while(i < src.length && depth > 0){
            if(src[i] === '{') depth++;
            else if(src[i] === '}') depth--;
            if(depth === 0) break;
            out += src[i++];
          }
          out += src[i] ?? ''; i++;      // the closing }
          depth = 0;
          continue;
        }
        keep(src[i++]);
      }
      out += src[i] ?? ''; i++;
      continue;
    }

    if(c === '/' && regexOk()){
      out += c; i++;
      let cls = false;
      while(i < src.length && (cls || src[i] !== '/') && src[i] !== '\n'){
        if(src[i] === '[') cls = true; else if(src[i] === ']') cls = false;
        if(src[i] === '\\') keep(src[i++]);
        keep(src[i++]);
      }
      out += src[i] ?? ''; i++;
      continue;
    }

    out += c; i++;
  }
  return out;
}

/** Every module specifier a file imports, read from the real source: an
 *  import always begins a line, which a sentence inside js/data/ never does. */
export function importsOf(src){
  // an import may wrap over several lines, but the names between `import` and
  // `from` never contain a quote or a semicolon - which is what stops the
  // pattern running away into the prose in js/data/
  return [...src.matchAll(/^[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s+['"]([^'"\n]+)['"]/gm)]
    .map(m => m[1]);
}

/** Lines of `src` where `re` matches, as "12: the line". */
export function linesMatching(src, re){
  return src.split('\n')
    .map((line, n) => re.test(line) ? `${n+1}: ${line.trim()}` : null)
    .filter(Boolean);
}

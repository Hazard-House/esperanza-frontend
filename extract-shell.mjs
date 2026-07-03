// extract-shell.mjs — one-shot: turn a scraped QMI detail page into the committed
// chrome shell used by every generated detail page. Re-run if the site chrome changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractShell } from './rewrite.mjs';

const SCRAPE = '/Users/mgd/Downloads/esperanzahomes.com-static-2026-06-08/www.esperanzahomes.com';
const SRC = join(SCRAPE, 'new-homes/tx/brownsville/palo-alto-groves/7522/2144-sand-lane/1751815/index.html');
const OUT = join(import.meta.dirname, 'templates', 'detail-shell.html');

mkdirSync(join(import.meta.dirname, 'templates'), { recursive: true });
const shell = extractShell(readFileSync(SRC, 'utf8'));
if (!shell.includes('<!--CONTENT-->')) throw new Error('extractShell did not produce a content marker');
if (!/<footer/.test(shell)) throw new Error('shell lost its footer');
writeFileSync(OUT, shell);
console.log(`wrote ${OUT} (${shell.length} bytes)`);

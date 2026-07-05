// generate-details.mjs — render all detail pages from live D1 into public/.
// Standalone (needs only committed templates + the API) OR called by build.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './data.mjs';
import { linksMap, qmiPath, communityPath, floorplanPath } from './paths.mjs';
import { renderQmi } from './render-qmi.mjs';
import { renderCommunity } from './render-community.mjs';
import { renderFloorplan } from './render-floorplan.mjs';

const OUT = join(import.meta.dirname, 'public');
const SHELL_PATH = join(import.meta.dirname, 'templates', 'detail-shell.html');

function writePage(urlPath, html) {
  const dst = join(OUT, urlPath.replace(/^\//, ''), 'index.html'); // urlPath ends with '/'
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, html);
}

// data + skip-sets are injectable so build.mjs can load the API once and skip
// entities it already shipped as hydrated scrape copies (clean paths in the sets).
export async function generateDetails(data, { skipCommunities, skipFloorplans } = {}) {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const shell = readFileSync(SHELL_PATH, 'utf8');
  const d = data || await loadData();
  const skipC = skipCommunities || new Set();
  const skipF = skipFloorplans || new Set();
  for (const h of d.qmis) writePage(qmiPath(h), renderQmi(h, shell));
  let nc = 0, nf = 0;
  for (const c of d.communities) if (!skipC.has(communityPath(c))) { writePage(communityPath(c), renderCommunity(c, shell)); nc++; }
  for (const fp of d.floorplans) if (!skipF.has(floorplanPath(fp))) { writePage(floorplanPath(fp), renderFloorplan(fp, shell)); nf++; }
  writeFileSync(join(OUT, 'qmi-links.json'), JSON.stringify(linksMap(d.qmis, d.communities)));
  console.log(`generate-details: ${d.qmis.length} qmi + ${nc}/${d.communities.length} community + ${nf}/${d.floorplans.length} floorplan pages (rest shipped from scrape)`);
  return { qmi: d.qmis.length, community: nc, floorplan: nf };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) generateDetails();

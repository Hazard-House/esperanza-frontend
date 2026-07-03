// generate-details.mjs — render all detail pages from live D1 into public/.
// Standalone (needs only committed templates + the API) OR called by build.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

export async function generateDetails() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const shell = readFileSync(SHELL_PATH, 'utf8');
  const d = await loadData();
  for (const h of d.qmis) writePage(qmiPath(h), renderQmi(h, shell));
  for (const c of d.communities) writePage(communityPath(c), renderCommunity(c, shell));
  for (const fp of d.floorplans) writePage(floorplanPath(fp), renderFloorplan(fp, shell));
  writeFileSync(join(OUT, 'qmi-links.json'), JSON.stringify(linksMap(d.qmis, d.communities)));
  console.log(`generate-details: ${d.qmis.length} qmi + ${d.communities.length} community + ${d.floorplans.length} floorplan pages`);
  return { qmi: d.qmis.length, community: d.communities.length, floorplan: d.floorplans.length };
}

if (import.meta.url === `file://${process.argv[1]}`) generateDetails();

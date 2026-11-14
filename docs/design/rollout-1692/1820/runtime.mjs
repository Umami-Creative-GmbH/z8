// Disposable local fixture only. Never publish its private manifests or cookies.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const [mode, fixtureDir] = process.argv.slice(2);
const repo = process.cwd();
const require = createRequire(join(repo, 'package.json'));
const puppeteer = require('puppeteer-core');
const { Client } = createRequire(join(repo, 'apps/webapp/package.json'))('pg');
const json = async name => JSON.parse(await readFile(join(fixtureDir, name), 'utf8'));
const runtime = await json('runtime-private.json');
const fixture = await json('fixture-private.json');
const actors = await json('dev-auth-private.json');
if (fixture.kind !== 'disposable' || new URL(runtime.origin).hostname !== 'localhost' || !/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB)) throw Error('Owned disposable fixture required');
const out = resolve('docs/design/rollout-1692/1820');
await mkdir(out, {recursive:true});
const adminCookies = actors['small-admin'].cookies.map(c=>`${c.name}=${c.value}`).join('; ');
const post = async (path, body) => {
  const response = await fetch(new URL(`/api/auth/organization/${path}`, runtime.origin), {method:'POST', headers:{'Content-Type':'application/json', Origin:runtime.origin, Cookie:adminCookies}, body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
};
if (mode === 'seed') {
  const ids = {};
  for (const label of ['valid','expired','revoked','used','stale']) {
    const data = await post('invite-member', {email:fixture.actors['large-employee'].email, role:'member', organizationId:fixture.actors['small-admin'].organizationId, resend:true});
    ids[label] = data.id;
    // Keep distinct real issued invitations; only status/date variants are seeded below.
    const db = new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
    await db.connect();
    if (label !== 'stale') await db.query('update invitation set status=$1, expires_at=case when $1=\'pending\' then now()-interval \'1 day\' else expires_at end where id=$2 and organization_id=$3', [label === 'expired' ? 'pending' : label === 'revoked' ? 'canceled' : 'accepted',data.id,fixture.actors['small-admin'].organizationId]);
    await db.end();
  }
  // Restore valid pending token after issuing the fixture variants (resend otherwise reuses it).
  const db = new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL}); await db.connect();
  await db.query('update invitation set status=\'pending\',expires_at=now()+interval \'1 day\' where id=$1 and organization_id=$2',[ids.valid,fixture.actors['small-admin'].organizationId]);
  await db.end();
  await writeFile(join(fixtureDir,'invitation-private.json'), JSON.stringify(ids),{mode:0o600});
  console.log('Issued synthetic invitation variants through real organization API.');
  process.exit(0);
}
const ids = await json('invitation-private.json');
const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors = [];
const result = {};
try {
  for (const [label, actor, id, width, height, dark] of [
    ['desktop-light','large-employee','valid',1600,1000,false],
    ['phone-light','large-employee','valid',390,844,false],
    ['wide-dark','large-employee','valid',2400,1200,true],
    ['phone-signedout',null,'valid',390,844,false],
    ['phone-mismatch','small-restricted','valid',390,844,false],
    ['expired','large-employee','expired',390,844,false],
    ['revoked','large-employee','revoked',390,844,false],
    ['used','large-employee','used',390,844,false],
    ['missing',null,'missing',390,844,false],
  ]) {
    const context = await browser.createBrowserContext();
    await context.overridePermissions(runtime.origin, []);
    if (actor) await context.setCookie(...actors[actor].cookies);
    const page = await context.newPage();
    page.on('pageerror', e=>errors.push(e.message));
    await page.setViewport({width,height});
    await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
    await page.goto(`${runtime.origin}/en/accept-invitation/${ids[id] ?? 'missing-invitation'}`,{waitUntil:'networkidle0',timeout:90000});
    await page.waitForFunction(()=>!document.body.innerText.includes('Checking your invitation details'));
    result[label] = await page.evaluate(()=>({headings:[...document.querySelectorAll('h1')].map(x=>x.textContent),text:document.querySelector('main')?.innerText,links:[...document.querySelectorAll('main a')].map(x=>({text:x.textContent,href:x.getAttribute('href')})),buttons:[...document.querySelectorAll('main button')].map(x=>({text:x.textContent,disabled:x.disabled,type:x.type})),width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
    await page.screenshot({path:join(out,`${mode}-${label}.png`),fullPage:true});
    await context.close();
  }
  await writeFile(join(out,`${mode}-runtime.json`),JSON.stringify({result,errors},null,2));
  console.log(`Captured ${Object.keys(result).length} real invitation states; ${errors.length} page errors.`);
} finally {await browser.close();}

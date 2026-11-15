import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const repo=process.cwd(),dir=process.argv[2];
const require=createRequire(join(repo,'package.json'));const puppeteer=require('puppeteer-core');
const pg=createRequire(join(repo,'apps/webapp/package.json'))('pg');
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
if(fixture.kind!=='disposable'||runtime.env.POSTGRES_HOST!=='127.0.0.1'||!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB))throw Error('Not an owned disposable fixture');
const pool=new pg.Pool({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
const browser=await puppeteer.connect({browserWSEndpoint:JSON.parse(await readFile(join(dir,'browser-private.json'),'utf8')).endpoint});
const out=join(repo,'docs/design/rollout-1692/1700');await mkdir(out,{recursive:true});
const source=join(repo,'apps/webapp/src/components/errors/no-organization-error.tsx');
const original=await readFile(source,'utf8');const heading='<h1>{t("errors.noOrganization.title", "No Organization Found")}</h1>';
if(!original.includes(heading))throw Error('Expected only owned heading change');
let memberships=[], context;
try{
 const actor=fixture.actors['small-admin'];
 const userId=(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[actor.employeeId,actor.organizationId])).rows[0]?.user_id;
 if(!userId)throw Error('Synthetic actor not resolved');
 context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['small-admin'].cookies);
 const p=await context.newPage();await p.setViewport({width:1600,height:1000});
 await p.goto(runtime.origin+'/en',{waitUntil:'networkidle2'});
 const clear=await p.evaluate(async()=>{const r=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:null})});return r.status;});
 if(clear!==200)throw Error('Could not clear synthetic active organization: '+clear);
 memberships=(await pool.query('delete from member where user_id=$1 and organization_id=$2 returning *',[userId,actor.organizationId])).rows;
 if(memberships.length!==1)throw Error('Expected one synthetic membership');
 const results=[];
 for(const phase of ['before','after']){
  await writeFile(source,phase==='before'?original.replace(heading,'{t("errors.noOrganization.title", "No Organization Found")}'):original);
  await p.goto(runtime.origin+'/en',{waitUntil:'networkidle2',timeout:120000});
  if(!(await p.$eval('body',e=>e.innerText.includes('No Organization Found'))))throw Error('No-organization arrival differs: '+p.url()+' '+await p.$eval('body',e=>e.innerText.slice(0,500)));
  const result=await p.evaluate(()=>({h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),create:[...document.querySelectorAll('button')].some(n=>n.textContent==='Create Organization'),invitation:document.body.innerText.includes('Waiting for an invitation?'),overflow:document.documentElement.scrollWidth>innerWidth}));
  await p.screenshot({path:join(out,'no-organization-'+phase+'.png'),fullPage:true});results.push({phase,...result});
 }
 if(results[0].h1.length!==0||results[1].h1[0]!=='No Organization Found'||!results.every(r=>r.create&&r.invitation&&!r.overflow))throw Error('Unexpected same-scope comparison');
 await writeFile(join(out,'comparison.json'),JSON.stringify({boundary:'Only no-organization title source changed; same real authenticated synthetic admin with its one membership temporarily removed. Exact source and membership restored in finally.',results},null,2));console.log(JSON.stringify(results));
}finally{
 await writeFile(source,original);
 for(const membership of memberships)await pool.query('insert into member select * from json_populate_record(null::member,$1::json)',[JSON.stringify(membership)]);
 await context?.close();await pool.end();await browser.disconnect();
}


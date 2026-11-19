import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
const repo=resolve('.'),audit=join(repo,'.tmp/merge1832-audit'),out=join(repo,'docs/design/rollout-1692/1832');
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024}).trim();
const raw=(ref,path)=>execFileSync('git',['show',`${ref}:${path}`],{cwd:repo,windowsHide:true,maxBuffer:32*1024*1024});
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const result={head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),checks:[],sourcePins:[],pngs:[],links:[],qualifications:[]};
function check(name,v){assert.ok(v,name);result.checks.push(name)}
const baseline=await json(join(audit,'baseline.json')),incoming='5a96bbad942c4fd29deb31dbce77a08002d4011b';
const actualChanges=git('diff','--name-only',baseline.head,'HEAD').split('\n').filter(Boolean),incomingChanges=git('diff','--name-only',incoming+'^',incoming).split('\n').filter(Boolean);
check('merge introduces exactly the incoming paths',JSON.stringify(actualChanges.sort())===JSON.stringify(incomingChanges.sort()));
for(const path of incomingChanges)check('incoming blob preserved '+path,git('rev-parse','HEAD:'+path)===git('rev-parse',incoming+':'+path));
check('independent merge tree equals actual merge',git('rev-parse','HEAD^{tree}')===(await readFile(join(audit,'merge-tree.txt'),'utf8')).replace(/^\uFEFF/,'').trim());
check('merge has exact expected parents',git('show','--no-patch','--format=%P','HEAD')===baseline.head+' '+incoming);
const ledger=await json(join(repo,'docs/design/rollout-1692/integration.json'));
for(const t of baseline.tickets){git('merge-base','--is-ancestor',t.verifiedCommit,'HEAD');result.checks.push('verified ancestor '+t.issue+' '+t.verifiedCommit)}
check('45 verified pins preserved',baseline.tickets.length===45);
result.graph={nodes:ledger.tickets.length,edges:ledger.tickets.reduce((n,t)=>n+t.blockedBy.length,0),persistent:ledger.tickets.filter(t=>t.route).length};
check('static 157-node 159-edge graph retained',result.graph.nodes===157&&result.graph.edges===159&&result.graph.persistent===153);
const publication=await readFile(join(repo,ledger.graphSource),'utf8'),aliases=publication.slice(publication.indexOf('## Redirect aliases')).split(/\r?\n/).filter(l=>/^\| R\d+ \|/.test(l));
const routes=git('ls-tree','-r','--name-only','HEAD','--','apps/webapp/src/app').split('\n').filter(p=>p.endsWith('/page.tsx')).map(p=>{const parts=p.replace('apps/webapp/src/app/','').replace(/\/page\.tsx$/,'').split('/').filter(x=>x!=='[locale]'&&!(x.startsWith('(')&&x.endsWith(')')));return parts.length?'/'+parts.join('/'):'/'});
const aliasRoutes=aliases.map(l=>l.split('|').slice(1,-1).map(p=>p.trim().replaceAll('`',''))[1]);
check('static 153 pages plus19 aliases equals172 source templates',aliases.length===19&&routes.length===172&&new Set(routes).size===172&&JSON.stringify([...routes].sort())===JSON.stringify([...ledger.tickets.filter(t=>t.route).map(t=>t.route),...aliasRoutes].sort()));
for(const [name,folder,historical]of[['before-runtime.json','',true],['verified/after-runtime.json','verified',false],['verified/variants-runtime.json','verified',false]]){
 const data=await json(join(out,name));check(name+' has no recorded browser/assertion failures',data.failed.length===0&&data.errors.length===0);
 for(const capture of data.captures){
  const png=await readFile(join(out,folder,capture.file));check(name+' '+capture.file+' dimensions',png.readUInt32BE(16)===capture.png.width&&png.readUInt32BE(20)===capture.png.height);check(name+' '+capture.file+' recorded width',capture.documentWidth===capture.viewport.width);
  for(const[path,pin]of Object.entries(capture.source.files)){
   const blob=git('rev-parse',(historical?data.source.head:'HEAD')+':'+path);check(capture.file+' source blob '+path,blob===pin.blob);
   const bytes=historical?raw(data.source.head,path):await readFile(join(repo,path));const rawHash=sha(bytes),crlfHash=sha(Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n').replaceAll('\n','\r\n')));
   check(capture.file+' source bytes with explicit newline qualification '+path,pin.sha256===rawHash||historical&&pin.sha256===crlfHash);
   result.sourcePins.push({capture:capture.file,path,blob,pinSha256:pin.sha256,rawSha256:rawHash,matchingRepresentation:pin.sha256===rawHash?(historical?'Git blob bytes':'physical checkout bytes'):'CRLF reconstructed from historical Git blob'});
  }
  if(capture.fontPreference==='large')check(capture.file+' recorded saved18px',capture.font==='18px');
 }
}
const crcTable=Array.from({length:256},(_,v)=>{for(let k=0;k<8;k++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0});
function crc32(b){let c=0xffffffff;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function decodePNG(bytes){assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');let offset=8,ihdr,idat=[],ended=false;while(offset<bytes.length){const size=bytes.readUInt32BE(offset),tag=bytes.subarray(offset+4,offset+8).toString(),body=bytes.subarray(offset+8,offset+8+size);assert.equal(body.length,size);assert.equal(crc32(bytes.subarray(offset+4,offset+8+size)),bytes.readUInt32BE(offset+8+size));if(tag==='IHDR')ihdr=body;if(tag==='IDAT')idat.push(body);offset+=size+12;if(tag==='IEND'){ended=true;break}}assert.ok(ended&&offset===bytes.length);const width=ihdr.readUInt32BE(0),height=ihdr.readUInt32BE(4),depth=ihdr[8],color=ihdr[9],channels={0:1,2:3,4:2,6:4}[color];assert.equal(depth,8);assert.ok(channels);assert.equal(ihdr[10],0);assert.equal(ihdr[11],0);assert.equal(ihdr[12],0);const data=inflateSync(Buffer.concat(idat)),stride=width*channels;assert.equal(data.length,(stride+1)*height);let prior=Buffer.alloc(stride);for(let y=0;y<height;y++){const row=Buffer.from(data.subarray(y*(stride+1)+1,(y+1)*(stride+1))),filter=data[y*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=prior[x],c=x>=channels?prior[x-channels]:0;let v=0;if(filter===1)v=a;if(filter===2)v=b;if(filter===3)v=Math.floor((a+b)/2);if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);v=pa<=pb&&pa<=pc?a:pb<=pc?b:c}row[x]=(row[x]+v)&255}prior=row}return{width,height,depth,color,decodedBytes:stride*height}}
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())await scan(p);else if(entry.name.endsWith('.png')){const b=await readFile(p);result.pngs.push({path:p.slice(repo.length+1).replaceAll('\\','/'),sha256:sha(b),...decodePNG(b)})}}}
await scan(out);check('every incoming PNG fully decodes with CRC/filter validation',result.pngs.length>0);
const report=join(repo,'docs/design/rollout-1692/1832.md');for(const match of(await readFile(report,'utf8')).matchAll(/\]\(([^)]+)\)/g)){const href=match[1];if(/^(https?:|#)/.test(href))continue;const p=resolve(dirname(report),href.split('#')[0]);await readFile(p);result.links.push(href)}
const native=await json(join(out,'final/native-source.json')),tree=await json(join(out,'final/native-tree.json'));check('inherited native target pins match current consumer',native.blob===git('rev-parse','HEAD:apps/webapp/src/app/[locale]/onboarding/welcome/page-client.tsx')&&tree.code===0&&tree.out.includes('WelcomeArrival')&&tree.out.includes('WelcomeFrame'));
const quality=await json(join(out,'quality.json'));for(const[path,pin]of Object.entries(quality.sourceHashes))check('worker quality byte pin '+path,sha(await readFile(join(repo,'apps/webapp',path)))===pin);
for(const[name,args]of[['source',['diff','--check',baseline.head,'HEAD','--','apps/webapp/src/app/[locale]/onboarding/welcome']],['archive',['diff','--check',baseline.head,'HEAD']]]){const r=spawnSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});await writeFile(join(audit,'whitespace-'+name+'.log'),(r.stdout??'')+(r.stderr??''));result[name+'Whitespace']={argv:['git',...args],exitCode:r.status};if(name==='source')check('source diff whitespace passes',r.status===0)}
result.qualifications=['Source and PNG correspondence do not rerun historical runtime; recorded current captures remain based on111dc9e5 with the pinned dirty welcome bytes.','Historical source byte pins use recorded CRLF checkout representation where Git stores LF; every accepted before pin was independently reconstructed and qualified.','Inherited78 PG archive command omits CLI verification guard; current committed launcher carries both guards. No guarded post-resume rerun is inferred.','Whole-directory dependency incident and raw archive whitespace remain preserved.','Fresh runtime/PG/native after source correction remains pending while the queued Activity-return blocker is open.'];
await writeFile(join(audit,'artifact-audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({head:result.head,tree:result.tree,checks:result.checks.length,pngs:result.pngs.length,sourcePins:result.sourcePins.length,links:result.links.length,graph:result.graph,whitespace:{source:result.sourceWhitespace.exitCode,archive:result.archiveWhitespace.exitCode}}));

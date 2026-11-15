// Read-only source/artifact correspondence. Does not load fixture secrets or execute application code.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const repo=resolve(process.argv[2]),out=join(repo,'docs/design/rollout-1692/1832');
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
const json=async p=>JSON.parse(await readFile(join(out,p),'utf8'));
const before=await json('before-runtime.json'),journey=await json('verified/after-runtime.json'),variants=await json('verified/variants-runtime.json'),native=await json('final/native-source.json');
const checks=[];const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
for(const [label,result]of[['before',before],['after',journey],['variants',variants]]){
 check(label+' has no failed checks',result.failed.length===0);
 for(const capture of result.captures){
  const p=join(out,label==='before'?'':'verified',capture.file);const png=await readFile(p);
  check(label+' '+capture.file+' exact PNG dimensions',png.readUInt32BE(16)===capture.png.width&&png.readUInt32BE(20)===capture.png.height);
  check(label+' '+capture.file+' no horizontal document overflow',capture.documentWidth===capture.viewport.width);
  for(const[path,pin]of Object.entries(capture.source.files)){
   if(label==='before')check(capture.file+' historical blob '+path,pin.blob===git('rev-parse',before.source.head+':'+path));
   else{
    check(capture.file+' current blob '+path,pin.blob===git('hash-object','--path',path,path));
    check(capture.file+' current bytes '+path,pin.sha256===createHash('sha256').update(await readFile(join(repo,path))).digest('hex'));
   }
  }
  if(capture.fontPreference==='large')check(capture.file+' actual saved18px',capture.font==='18px');
 }
}
const page='apps/webapp/src/app/[locale]/onboarding/welcome/page-client.tsx';
check('native target uses current welcome blob',native.blob===git('hash-object','--path',page,page));
const tree=await json('final/native-tree.json');check('native actual target tree',tree.code===0&&tree.out.includes('WelcomeArrival')&&tree.out.includes('WelcomeFrame'));
const quality=await json('quality.json');check('all final quality commands passed',quality.commands.length===5&&quality.commands.every(c=>c.exitCode===0));
for(const[path,sha]of Object.entries(quality.sourceHashes))check('quality source bytes '+path,sha===createHash('sha256').update(await readFile(join(repo,'apps/webapp',path))).digest('hex'));
const doctor=await json('doctor-final.json');check('Doctor zero findings',doctor.ok&&doctor.diagnostics.length===0);
const unit=await json('unit-final-state.json');check('72 selected tests passed',unit.numPassedTests===72&&unit.numFailedTests===0);
const pg=await json('postgres.json');check('78 real PG tests passed',pg.numPassedTests===78&&pg.numFailedTests===0);
check('default Next config byte-exact',Buffer.compare(await readFile(join(repo,'apps/webapp/next.config.ts')),await readFile(join(repo,'.tmp/1832-next.config.original')))===0);
check('approved lock SHA256',createHash('sha256').update(await readFile(join(repo,'pnpm-lock.yaml'))).digest('hex').toUpperCase()==='2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799');
const required=['11671b30d78f9bc12be6f991ed4638218cc75777','0012c8bbb','4cb26d6e','b6595389e0ebf15b4ec9afc44d6d8f92ff2017c5'];
for(const ref of required){git('merge-base','--is-ancestor',ref,'HEAD');checks.push('required ancestor '+ref);}
const latest=git('rev-parse','ai/1692-app-wide-ui-refresh');git('merge-base','--is-ancestor',latest,'HEAD');checks.push('latest local AI is ancestor');
await writeFile(join(out,'evidence-verification.json'),JSON.stringify({head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),latestLocalAI:latest,currentWelcomeBlob:native.blob,checks,acceptedRuntime:['before-runtime.json','verified/after-runtime.json','verified/variants-runtime.json','final/native-tree.json'],qualification:'Historical consumer baseline/current shared shell; actual browser variants distinct from assembled-only lifecycle races'},null,2)+'\n');
console.log(`Passed ${checks.length} artifact, source, quality and ancestry checks.`);

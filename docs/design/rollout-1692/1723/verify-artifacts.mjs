import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=process.cwd(),dir=resolve('docs/design/rollout-1692/1723'),require=createRequire(join(root,'package.json'));
const browser=await require('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report={sourceCommit:process.argv[2]??null,pngs:[],pairs:[],sources:[]};
try{
 const page=await browser.newPage();
 for(const name of await readdir(dir))if(name.endsWith('.png')){
 const bytes=await readFile(join(dir,name));const dimensions=await page.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();return{width:img.naturalWidth,height:img.naturalHeight};},`data:image/png;base64,${bytes.toString('base64')}`);
 assert.equal(dimensions.width,bytes.readUInt32BE(16));assert.equal(dimensions.height,bytes.readUInt32BE(20));report.pngs.push({name,...dimensions});
 }
 const before=JSON.parse(await readFile(join(dir,'before-large-captures.json'))),after=JSON.parse(await readFile(join(dir,'accepted-after-captures.json')));
 for(let i=0;i<before.captures.length;i++){
 const a=before.captures[i],b=after.captures[i];assert.equal(a.label,b.label);assert.deepEqual(a.css,b.css);assert.equal(a.fontSize,b.fontSize);assert.deepEqual(a.titles,b.titles);report.pairs.push({label:a.label,css:a.css,fontSize:a.fontSize});
 }
 if(report.sourceCommit)for(const [path,hash] of Object.entries(after.sources)){
 const bytes=execFileSync('git',['show',`${report.sourceCommit}:${path}`]);const text=bytes.toString('utf8').replace(/\r\n/g,'\n');const candidates=[text,text.replace(/\n/g,'\r\n')].map(s=>createHash('sha256').update(s).digest('hex'));assert.ok(candidates.includes(hash),path);report.sources.push({path,matched:true,lineEndingTolerance:'LF/CRLF only'});
 }
}finally{await browser.close();}
await writeFile(join(dir,'artifact-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(`Decoded ${report.pngs.length} PNGs; verified ${report.pairs.length} pairs and ${report.sources.length} pinned source files.`);

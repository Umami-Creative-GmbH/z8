import { readFileSync, writeFileSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = dirname(fileURLToPath(import.meta.url));
const base = '58ea18603a936d102f0625e3303f4c05689a9961';
const incoming = '16e4597833181cf411138d24e5116dded09ecc3b';
const expectedTree = 'a0fa398d5992e28d073db0e9a80dbbede5ef5a71';
const git = args => execFileSync('git', args, {cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(resolve(root,path),'utf8').replace(/^\uFEFF/,''));
const ensure = (ok, message) => { if (!ok) throw Error(message); };
const require = createRequire(resolve(root,'apps/webapp/package.json'));
const evidence = 'docs/design/rollout-1692/1736';
const tree = rev => new Map(git(['ls-tree','-r',rev]).split('\n').map(line => { const [entry,path] = line.split('\t'); const [mode,type,blob] = entry.split(' '); return [path,{mode,type,blob}]; }));
const before = tree(base), after = tree('HEAD'), child = tree(incoming);
const changed = [...after].filter(([path,value])=>before.get(path)?.blob!==value.blob || before.get(path)?.mode!==value.mode).map(([path])=>path);
const source = changed.filter(path=>path.startsWith('apps/webapp/src/'));
ensure(source.length===14 && changed.length===75,'Unexpected merge scope');
ensure(git(['rev-parse','HEAD^{tree}'])===expectedTree,'Merge differs from independent tree');
ensure(git(['show','-s','--format=%P','HEAD'])===`${base} ${incoming}`,'Wrong exact merge parents');
let preserved=0;
for(const [path,value] of before){
 ensure(after.has(path),'Deleted baseline path '+path);
 if(source.includes(path)) ensure(after.get(path).blob===child.get(path).blob,'Incoming source changed '+path);
 else { ensure(after.get(path).blob===value.blob && after.get(path).mode===value.mode,'Baseline overwritten '+path); preserved++; }
}
for(const path of changed) ensure(after.get(path).blob===child.get(path).blob,'Incoming evidence changed '+path);
const ledger=json('docs/design/rollout-1692/integration.json');
const verified=ledger.tickets.filter(ticket=>ticket.verifiedCommit);
ensure(verified.length===48,'Unexpected recorded verified ticket count '+verified.length);
const ancestors=verified.map(ticket=>{const probe=spawnSync('git',['merge-base','--is-ancestor',ticket.verifiedCommit,'HEAD'],{cwd:root});ensure(probe.status===0,'Lost verified ancestor '+ticket.issue);return {issue:ticket.issue,commit:ticket.verifiedCommit};});
for(const rev of ['c0a9590349f2d6042fe20c7e4fd2d2be5e21f14f','ca6f607d683c69ee47e7558fae78b1dcd1b53914','4ba74f991','1230f617']) ensure(spawnSync('git',['merge-base','--is-ancestor',rev,'HEAD'],{cwd:root}).status===0,'Missing required root ancestor '+rev);
for(const rev of ['7fc82645ae809bf4ee28d3c5edc32766703fc0cc','6175e84f63208e234ac55c7c3933620072d0fb3c']) ensure(spawnSync('git',['merge-base','--is-ancestor',rev,'HEAD'],{cwd:root}).status===1,'Queued peer merged unexpectedly');
const protectedPaths=json(`${evidence}/protected-paths.json`).map(item=>item.File);
for(const path of protectedPaths) ensure(before.get(path).blob===after.get(path).blob,'Changed protected report leaf '+path);
const prior1834=[...before.keys()].filter(path=>path.startsWith('docs/design/rollout-1692/1834/'));
const manifestPaths=[...new Set([...changed,...protectedPaths,...prior1834])].sort();
const preservation={base,incoming,merge:git(['rev-parse','HEAD']),tree:expectedTree,parents:[base,incoming],verifiedAncestors:ancestors,preservedBaselinePaths:preserved,totalBaselinePaths:before.size,changedPaths:75,changedSourcePaths:14,protectedReportPaths:7,prior1834ArtifactPaths:prior1834.length,baselineTreeDigest:sha([...before].map(([p,v])=>`${p}\0${v.mode}\0${v.blob}\n`).join('')),paths:manifestPaths.map(path=>({path,before:before.get(path)?.blob??null,incoming:child.get(path)?.blob??null,merged:after.get(path).blob}))};
writeFileSync(join(out,'preservation.json'),JSON.stringify(preservation,null,2));

const sharp=require('sharp'); let decoded=0, jsonCount=0, scripts=0;
for(const path of changed.filter(path=>path.startsWith(evidence+'/'))){
 if(path.endsWith('.json')){json(path);jsonCount++;}
 if(path.endsWith('.png')){const bytes=readFileSync(resolve(root,path));const decodedImage=await sharp(bytes).raw().toBuffer({resolveWithObject:true});ensure(decodedImage.info.width>0 && decodedImage.data.length>0,'PNG failed full decode '+path);decoded++;}
 if(path.endsWith('.mjs')){const syntax=spawnSync(process.execPath,['--check',resolve(root,path)],{encoding:'utf8'});ensure(syntax.status===0,'Script syntax '+path+': '+syntax.stderr);scripts++;}
}
const captureRecords=[];
for(const phase of ['before','after','after-dark','after-dark-large']){
 const capture=json(`${evidence}/${phase}-captures.json`);
 for(const pin of capture.sources){
  if(phase==='before'){const bytes=execFileSync('git',['show',`${capture.base}:${pin.file}`],{cwd:root});ensure(sha(bytes)===pin.sha256,'Historical source hash '+pin.file);}
  else ensure(after.get(pin.file).blob===pin.gitBlob,'Canonical current capture pin '+pin.file);
 }
 for(const record of capture.captures){
  const bytes=readFileSync(resolve(root,evidence,record.file)); ensure(sha(bytes)===record.sha256,'PNG recorded hash '+record.file);
  const {info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
  ensure(info.width===record.measurement.viewport[0]&&info.height===record.measurement.viewport[1],'PNG recorded size '+record.file);
  ensure(record.measurement.headings.length===1&&record.measurement.documentWidth<=info.width,'Recorded heading/overflow '+record.file);
  captureRecords.push({file:record.file,width:info.width,height:info.height,sourceCount:capture.sources.length,fullDecoded:true});
 }
}
for(const pin of json(`${evidence}/source-pins.json`).dirtySourcePins) ensure(after.get(pin.file).blob===pin.gitBlob,'Owned canonical source pin '+pin.file);
const Papa=require('papaparse');const ExcelJS=require('exceljs');
const {getDocument}=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const downloads=[];
for(const record of json(`${evidence}/downloads.json`)){
 const bytes=readFileSync(resolve(root,evidence,'downloads',`${record.kind}.${record.format}`));
 ensure(sha(bytes)===record.sha256&&record.completedBrowserEvent,'Inherited completed file pin');
 let cells=[], text='';
 if(record.format==='csv'){const rows=Papa.parse(bytes.toString('utf8'),{skipEmptyLines:true}).data;cells=rows.map(row=>row.map(String));text=cells.flat().join(' ');}
 if(record.format==='xlsx'){const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);cells=book.worksheets.flatMap(sheet=>sheet.getSheetValues().filter(Array.isArray).map(row=>row.slice(1).map(value=>value==null?'':String(value))));text=cells.flat().join(' ');}
 if(record.format==='pdf'){const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const pdf=await task.promise;for(let n=1;n<=pdf.numPages;n++){const content=await(await pdf.getPage(n)).getTextContent();cells.push(content.items.filter(item=>'str'in item&&item.str.trim()).map(item=>item.str));}text=cells.flat().join(' ');await task.destroy();}
 ensure(text.includes('2026-11-01')&&text.includes('2026-11-30')&&text.includes('R062 Delivery'),'Parsed document scope');
 const identity=record.kind==='customer'&&record.format==='pdf'?'Total':record.kind==='customer'?'R062 Synthetic customer':'R062 Delivery';const expected=record.kind==='customer'?6:5;
 let observed=[];
 for(const row of cells)for(let i=0;i<row.length-1;i++)if(row[i]===identity&&/^-?\d+(?:\.\d+)?$/.test(row[i+1]))observed.push(Number(row[i+1]));
 ensure(observed.includes(expected),`Actual numeric hours ${record.kind}/${record.format}: ${observed}`);
 if(record.kind==='shared') ensure(!/Cost|Margin|Kosten|Marge|Person 2|Delivery task|Synthetic report comparison/.test(text),'Shared content not trimmed');
 else ensure(text.includes('Cost unknown')&&/(?:^|\s)500(?:\.00)?(?:\s|$)/.test(text),'Money/unknown values changed '+record.kind+'/'+record.format);
 if(record.kind==='customer') ensure(text.includes('R062 Synthetic customer')&&text.includes('R062 Unpriced')&&/(?:^|\s)1(?:\.00)?(?:\s|$)/.test(text),'Unpriced customer row missing');
 downloads.push({kind:record.kind,format:record.format,actualHours:expected,numericCandidates:observed,sha256:record.sha256,inheritedCompletedBrowserEvent:true,freshlyParsed:true});
}
ensure(downloads.length===9,'Expected nine downloaded files');
const report=readFileSync(resolve(root,evidence+'.md'),'utf8');
const links=[...report.matchAll(/\]\(([^)]+)\)/g)].map(match=>match[1]).filter(link=>!link.startsWith('http'));
for(const link of links) ensure(existsSync(resolve(root,'docs/design/rollout-1692',link.split('#')[0])),'Broken report link '+link);
const previousInventory=json('docs/design/rollout-1692/1834/root-loading-heading/merger/route-inventory.json');
const inventoryArrays=Object.entries(previousInventory).filter(([,value])=>Array.isArray(value));
const pages=[...after.keys()].filter(path=>/^apps\/webapp\/src\/app\/.+\/page\.tsx$/.test(path));
ensure(pages.length===172,'Route template count changed');
const persistent=previousInventory.persistent;
const aliasPair=inventoryArrays.find(([,value])=>value.length===19);
ensure(persistent.length===153&&aliasPair,'Missing approved 153+19 inventory');
const expectedFiles=[...persistent,...aliasPair[1]].map(item=>item.file??item.sourceFile??item.source);
ensure(expectedFiles.every(file=>pages.includes(file))&&new Set(expectedFiles).size===172,'Static172 inventory mismatch');
const initialDev='2dd336ccfe3b7fb084263eca6c2360df5e58bfa7';
for(const item of aliasPair[1]){const path=item.file??item.sourceFile??item.source;ensure(after.get(path).blob===git(['rev-parse',`${initialDev}:${path}`]),'Alias source changed '+path);}
const artifacts={merge:preservation.merge,pngFullDecoded:decoded,acceptedCaptureRecords:captureRecords,jsonParsed:jsonCount,scriptSyntaxChecked:scripts,reportLinksChecked:links.length,downloads,sourcePinsCanonicalMatch:true,staticRouteInventory:{persistent:153,aliases:19,total:172,aliasSourcesUnchangedFromInitialDev:true},limits:['Static coverage does not prove alias locale/query/access runtime behavior.','Browser completion events and captures are inherited; nine files were freshly parsed and hashes checked.','No PostgreSQL, fixture, Next or browser started while public source blockers remain.']};
writeFileSync(join(out,'artifacts.json'),JSON.stringify(artifacts,null,2));
console.log(JSON.stringify({preservation:{baselinePaths:before.size,preserved,verifiedTickets:verified.length,prior1834Artifacts:prior1834.length,manifestPaths:manifestPaths.length},artifacts:{decoded,jsonCount,scripts,downloads:downloads.length,captures:captureRecords.length,routes:pages.length}}));

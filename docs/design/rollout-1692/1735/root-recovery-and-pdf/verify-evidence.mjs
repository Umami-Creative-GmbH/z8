#!/usr/bin/env node
// READ ONLY. Parses archived source as text; never imports archived harnesses.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';

const PAYLOAD_INDEX_SHA='a026822f3f63a65b068dbd372d69b23967f81e70e46342d324b4cc27b0f84736';
const archive=dirname(fileURLToPath(import.meta.url)), archiveReal=realpathSync(archive);
let repo=archive;
while(!existsSync(join(repo,'pnpm-workspace.yaml'))){const parent=dirname(repo);assert.notEqual(parent,repo);repo=parent;}
const flags=process.argv.slice(2);assert.ok(flags.length<=1&&flags.every(x=>x==='--current-source'));
const current=flags.includes('--current-source');
const sha=b=>createHash('sha256').update(b).digest('hex');
const lf=b=>Buffer.from(b.toString('utf8').replaceAll('\r\n','\n'));
const blob=b=>createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
function safe(p){assert.equal(typeof p,'string');assert.ok(p&&!isAbsolute(p)&&!/[\\:\x00-\x1f]/.test(p));assert.ok(p.split('/').every(x=>x&&x!=='.'&&x!=='..'));return p;}
function read(p){safe(p);const file=join(archive,p),s=lstatSync(file),r=relative(archiveReal,realpathSync(file));assert.ok(s.isFile()&&!s.isSymbolicLink()&&r&&!isAbsolute(r)&&!r.startsWith('..'));return readFileSync(file);}
const text=p=>read(p).toString('utf8'), json=p=>JSON.parse(text(p).replace(/^\uFEFF/,''));
function files(dir=archive,prefix=''){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{assert.ok(!e.isSymbolicLink());return e.isDirectory()?files(join(dir,e.name),prefix+e.name+'/'):[safe(prefix+e.name)];}).sort();}
function checkEntry(e){safe(e.path);const b=read(e.path);assert.equal(b.length,e.bytes,e.path+' bytes');assert.equal(sha(b),e.sha256,e.path+' SHA256');return b;}
function checkIndex(index){assert.equal(index.digest,sha(JSON.stringify(index.files)));assert.equal(new Set(index.files.map(x=>x.path)).size,index.files.length);let bytes=0;for(const e of index.files)bytes+=checkEntry(e).length;assert.equal(bytes,index.bytes);return bytes;}
assert.equal(sha(read('payload-index.json')),PAYLOAD_INDEX_SHA);
const payload=json('payload-index.json');checkIndex(payload);
const publication=json('publication-index.json');checkIndex(publication);
const seal=json('publication-seal.json');assert.equal(seal.excludesSelf,true);checkIndex(seal);
assert.deepEqual(files(),[...seal.files.map(e=>e.path),'publication-seal.json'].sort());
assert.deepEqual(publication.files.map(e=>e.path).sort(),seal.files.map(e=>e.path).filter(p=>p!=='publication-index.json').sort());
assert.deepEqual(payload.files.map(e=>e.path).sort(),publication.files.map(e=>e.path).filter(p=>!['payload-index.json','verify-evidence.mjs'].includes(p)).sort());

const appRequire=createRequire(join(repo,'apps/webapp/package.json'));
const parser=createRequire(appRequire.resolve('next/package.json'))('@babel/parser');
let jsonCount=0,jsoncCount=0,modules=0,typed=0,links=0;
const pngs=[];
for(const p of files()){
 const b=read(p),s=b.toString('utf8');
 if(p.endsWith('.jsonc')||/\/tsconfig(?:\.[^/]*)?\.json$/.test(p)){parseJsonc(s);jsoncCount++;}
 else if(p.endsWith('.json')){JSON.parse(s.replace(/^\uFEFF/,''));jsonCount++;}
 if(p.endsWith('.mjs')){parser.parse(s,{sourceType:'module',plugins:['topLevelAwait']});modules++;}
 if(/\.tsx?$/.test(p)){parser.parse(s,{sourceType:'module',plugins:['typescript','jsx']});typed++;}
 if(p.endsWith('.png'))pngs.push({path:p,...decodePng(b)});
 if(p.endsWith('.md'))for(const m of s.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)){
  const target=m[1];if(/^(https?:|#)/i.test(target))continue;
  const resolved=resolve(archive,dirname(p),decodeURIComponent(target.split('#')[0])),rel=relative(archive,resolved);
  assert.ok(rel&&!isAbsolute(rel)&&!rel.startsWith('..'),'Public archive Markdown link leaves archive');assert.ok(existsSync(resolved),'Missing Markdown link '+p+' -> '+target);links++;
 }
}
assert.equal(pngs.length,12);
const allow=json('runtime/safe-public-allowlist-final.json');assert.equal(allow.files.length,74);
assert.equal(sha(read('runtime/safe-public-allowlist-final.json')),'91c9a42d0216c0dc072575cba88d22261fdcfe3a29ab74629c72424260f215d7');
assert.equal(sha(read('runtime/seal-final.json')),'e7947e8873d9514aa5a9f2ea09868ddf0523249d96f0a08e8d95a9ef30b48621');
assert.deepEqual(files().filter(p=>p.startsWith('runtime/')).map(p=>p.slice(8)).sort(),[...allow.files.map(x=>x.path),'safe-public-allowlist-final.json','seal-final.json'].sort());
for(const e of allow.files)checkEntry({...e,path:'runtime/'+e.path});
const originalSeal=json('runtime/seal-final.json');assert.equal(originalSeal.files.length,293);
assert.equal(originalSeal.publicAllowlistFiles,74);assert.equal(originalSeal.verifiedCommit1735,null);
assert.equal(sha(read('provenance/compiled-pdf-stop-seal-final.json')),'cab47fa2707cabadb7b67bfe00e0f906a94a13d71e0edeb0a8ba2f6e1efe64e2');
assert.equal(sha(read('provenance/compiled-pdf-stop-safe-public-allowlist-final.json')),'e09d42310b77531d60d5f3c1cf80272b297c12a6bc009c0d2129da6fb536eb39');
const map=json('provenance/publication-map.json');assert.equal(map.runtimeFiles,74);
for(const s of map.selections){const b=read(s.published);assert.equal(b.length,s.bytes);assert.equal(sha(b),s.sha256);}
for(const c of map.clones){const r=json(c.published);assert.match(r.kind,/Derived public/);assert.deepEqual(r.original,c.original);assert.ok(c.changes.length);}
const exclusions=json('publication-exclusions.json');assert.ok(exclusions.privatePayloadsNeverCopiedOrRead.length);assert.equal(exclusions.excludedOldReceiptReferences.length,2);
assert.ok(files().every(p=>!/(?:^|\/)(?:\.env|exports|fixture-\d+-private|download-\d+)/i.test(p)&&!p.endsWith('-private.json')));

const pins=json('source-pins.json');assert.equal(pins.candidate,'1d328a1b352fa6504d58b443367b6aabeda56fcb');assert.equal(pins.tree,'e2419f58997932018c617f0babcea93a9a66d4d1');assert.equal(pins.lastVerified,'9f2bd756833e85a33a97db496487afbc992c69ae');assert.equal(pins.verifiedCommit,null);assert.equal(pins.sourcePins.length,15);assert.equal(pins.configPins.length,11);
for(const p of [...pins.sourcePins,...pins.configPins]){
 safe(p.path);assert.ok(!p.path.endsWith('integration.json')&&!p.path.endsWith('licenses.json'));
 const b=read(p.archivePath);assert.equal(b.length,p.bytes);assert.equal(sha(b),p.rawSha256);assert.equal(lf(b).length,p.lfBytes);assert.equal(sha(lf(b)),p.lfSha256);assert.equal(blob(b),p.rawGitBlob);assert.equal(blob(lf(b)),p.canonicalGitBlob);
 if(p.historicalRuntimePin){assert.equal(p.historicalRuntimePin.sha256,p.rawSha256);assert.equal(p.historicalRuntimePin.gitBlob,p.canonicalGitBlob);}
 if(current){const c=readFileSync(join(repo,p.path));assert.equal(c.length,p.bytes,p.path+' current bytes');assert.equal(sha(c),p.rawSha256,p.path+' current raw hash');assert.equal(sha(lf(c)),p.lfSha256);}
}
const prefix=json('report-prefix.json'),report=readFileSync(join(repo,prefix.path));
const rawPrefix=sha(report.subarray(0,prefix.bytes))===prefix.rawSha256,canonicalPrefix=sha(lf(report).subarray(0,prefix.lfBytes))===prefix.lfSha256;
assert.ok(rawPrefix||canonicalPrefix,'Original report prefix changed');assert.equal([...report.toString('utf8').matchAll(/^## Root integration verification and compiled PDF recovery\r?$/gm)].length,1);
assert.equal(text('.gitattributes'),'* -text whitespace=cr-at-eol\n');

const checks=json('runtime/checks-final-02.json');assert.equal(checks.verdict,'PASS_BOUNDED_CURRENT_PDF_AND_ROUTE_ACCEPTANCE');assert.equal(checks.verifiedCommit1735,null);
const pdf=json('runtime/download-parsed-01-pdf-public.json'),csv=json('runtime/download-parsed-01-csv-public.json'),xlsx=json('runtime/download-parsed-01-xlsx-public.json'),parity=json('runtime/canonical-export-controls-01.json');
for(const r of [pdf,csv,xlsx]){assert.equal(r.completed,true);assert.match(r.kind,/clone/);assert.match(r.rawSha256,/^[a-f0-9]{64}$/);assert.ok(!/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(JSON.stringify(r)));}
assert.deepEqual([pdf.bytes,csv.bytes,xlsx.bytes],[9344,1706,10605]);assert.equal(pdf.parsed.pages.length,3);
assert.equal(pdf.sha256,parity.pdf.sha256);assert.equal(csv.sha256,parity.controls.csv.sha256);assert.equal(xlsx.sha256,parity.controls.xlsx.sha256);
assert.equal(parity.verdict,'PASS_COMPLETED_PDF_CSV_XLSX_CONTROLS');assert.equal(parity.observed.organizationScoped,true);assert.equal(parity.observed.employeeScoped,true);
assert.deepEqual(parity.observed.range,{start:'2025-01-01',end:'2025-12-31'});assert.deepEqual([parity.observed.minutes,parity.observed.days,parity.observed.homeMinutes,parity.observed.homeDays],[125280,261,24960,52]);
assert.equal(parity.observed.months.length,12);for(const m of parity.observed.months)assert.ok(pdf.parsed.text.includes(m.month));
const csvRows=csv.parsed.rows.map(r=>Array.isArray(r)?r:r.value);
const xlsxRows=xlsx.parsed.sheets.flatMap(s=>s.rows);
assert.deepEqual(xlsx.parsed.sheets.map(s=>s.name),['Summary','Work Hours','Absences','Home Office (Tax)']);
assert.equal(parity.observed.home.length,52);
for(const h of parity.observed.home){assert.ok(pdf.parsed.text.includes(h.date));assert.ok(csvRows.some(r=>r[0]===h.date&&Number(r[1])===h.minutes/60));assert.ok(xlsxRows.some(r=>r[0]===h.date&&Number(r[1])===h.minutes/60));}
for(const m of parity.observed.months){assert.ok(csvRows.some(r=>r[0]===m.month&&Number(r[1])===m.minutes/60&&Number(r[2])===m.days));assert.ok(xlsxRows.some(r=>r[0]===m.month&&Number(r[1])===m.minutes/60&&Number(r[2])===m.days));}
assert.match(pdf.parsed.text,/2088h/);assert.match(pdf.parsed.text,/261/);assert.match(pdf.parsed.text,/416h/);assert.match(pdf.parsed.text,/Generated by Z8 Time Tracking/);
const display=json('runtime/display-context-parity-01.json');assert.deepEqual([display.fixtureTimezone,display.fixtureLocale,display.fixtureTimeFormat],['Europe/Berlin','en','24h']);assert.equal(display.actualGeneratedOn,display.expectedFromActualNativeFileBoundary);assert.ok(pdf.parsed.text.includes(display.actualOriginalFooter));
const flow=json('runtime/runtime-flow-result-01.json');assert.equal(flow.generateFailure.actualTransportAbort,true);assert.equal(flow.generateFailure.retainedReport,true);assert.equal(flow.generateFailure.localRetryUsesCaptured2025CommandDespiteCurrentMonthDraft,true);assert.equal(flow.rosterFailure.localRetry,true);assert.equal(flow.keyboard.firstEscapeClosesPeriodPopup,true);
const native=json('runtime/native-react-target-03-public.json');assert.equal(native.exactReportsContainerTarget,true);assert.equal(native.inspectSuccess,true);
const next=json('runtime/next-probes-03-public.json');assert.deepEqual(JSON.parse(next.probes.find(p=>p.name==='get_compilation_issues').summary),{issues:[]});assert.deepEqual(JSON.parse(next.probes.find(p=>p.name==='get_errors').summary),{configErrors:[],sessionErrors:[]});assert.equal(JSON.parse(next.probes.find(p=>p.name==='get_page_metadata').summary).sessions[0].url,'/en/reports');
const staticChecks=json('history/pdf-correction/checks.json');assert.deepEqual([staticChecks.unit.cases,staticChecks.unit.files,staticChecks.quality.scopedFiles,staticChecks.quality.lintExit],[294,52,15,0]);assert.deepEqual([staticChecks.quality.types.projects,staticChecks.quality.types.exit],[3,0]);assert.deepEqual([staticChecks.quality.doctor.errors,staticChecks.quality.doctor.warnings],[0,1]);assert.deepEqual([staticChecks.quality.broadExplicit100Errors,staticChecks.quality.broadOrdinaryFormattingErrors],[5,10]);
assert.equal(json('history/settings-correction/attempt-limitations.json').completeRawHistoryClaim,false);
const accounting=json('test-accounting.json');const root=json(accounting.root.path),pg=json(accounting.inheritedPostgres.path),fresh=json('runtime/compiled-result-01.json');
assert.deepEqual(root.reported,{total:294,passed:294,failed:0,pending:0,todo:0});assert.equal(root.files.length,52);assert.equal(root.files.flatMap(f=>f.cases).length,294);
assert.deepEqual([pg.passed,pg.failed,pg.physicalFiles],[14,0,2]);assert.deepEqual([fresh.passed,fresh.failed,fresh.physicalFiles],[2,0,2]);
const caseKeys=list=>list.flatMap(f=>{const seen=new Map();return f.cases.map(c=>{const name=c.fullName??c.name,occurrence=(seen.get(name)??0)+1;seen.set(name,occurrence);return f.path+'\0'+name+'\0'+occurrence;});});
const unionKeys=[...caseKeys(root.files),...caseKeys(pg.files)];assert.equal(unionKeys.length,308);assert.equal(new Set(unionKeys).size,308);assert.equal(new Set([...root.files,...pg.files].map(f=>f.path)).size,54);
for(const f of fresh.files)for(const c of f.cases)assert.ok(root.files.some(r=>r.path===f.path&&r.cases.some(a=>a.fullName===c.name&&a.status==='passed')),'Fresh compiler case must overlap root');
assert.deepEqual(accounting.selectedUnion,{cases:308,physicalFiles:54,mixedSnapshot:true,freshPostgres:false});assert.equal(accounting.freshCompiled.additive,false);
assert.equal(json('history/compiled-pdf-stop/checks-01.json').verdict,'STOP_SOURCE_BLOCKER');
console.log(JSON.stringify({status:'verified',candidate:pins.candidate,verifiedCommit:null,currentSourceChecked:current,payloadFiles:payload.files.length,payloadBytes:payload.bytes,publicationFiles:seal.files.length+1,publicationDigest:seal.digest,runtimeSafeFiles:74,originalRuntimeIndexedFiles:293,sourcePins:15,configPins:11,rootUnitCases:294,rootUnitFiles:52,freshCompiledCases:2,freshCompiledFiles:2,freshCompiledAdditive:false,inheritedPostgresCases:14,inheritedPostgresFiles:2,mixedSnapshotUnionCases:308,mixedSnapshotUnionFiles:54,inheritedIndependentPublicCases:9,parsedJson:jsonCount,parsedJsonc:jsoncCount,syntaxModules:modules,syntaxTyped:typed,fullyDecodedPngs:pngs.length,decodedPixelBytes:pngs.reduce((n,p)=>n+p.decodedBytes,0),localMarkdownLinks:links,rawReportPrefix:rawPrefix,canonicalReportPrefix:canonicalPrefix,archivedHarnessesExecuted:0,applicationTestsRerun:0,privateInputsRead:false,fileWrites:0,servicesStarted:0,gitOperations:0,readinessAdvanced:false}));

// PNG and JSONC parser helpers follow. They decode source bytes only.

// JSONC lexer removes comments and trailing commas only outside strings.
function parseJsonc(input) {
  let output = '', string = false, escape = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1];
    if (string) { output += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') string = false; continue; }
    if (c === '"') { string = true; output += c; continue; }
    if (c === '/' && n === '/') { while (i < input.length && input[i] !== '\n') i++; output += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) { if (input[i] === '\n') output += '\n'; i++; } assert.ok(i < input.length, 'Unclosed JSONC comment'); i++; continue; }
    output += c;
  }
  let cleaned = ''; string = false; escape = false;
  for (let i = 0; i < output.length; i++) { const c = output[i]; if (string) { cleaned += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') string = false; } else { if (c === '"') string = true; if (c === ',') { let j = i + 1; while (/\s/.test(output[j] ?? '') && j < output.length) j++; if (output[j] === ']' || output[j] === '}') continue; } cleaned += c; } }
  return JSON.parse(cleaned.replace(/^\uFEFF/, ''));
}
// Complete RGB/RGBA8 noninterlaced PNG pixel reconstruction for these 12 accepted pins.
// Every chunk CRC, stream length, scanline filter and reconstructed pixel is read.
function decodePng(b) {
  assert.ok(b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  let offset = 8, header, ended = false; const streams = [];
  while (offset < b.length) { assert.ok(offset + 12 <= b.length); const length = b.readUInt32BE(offset), end = offset + 12 + length; assert.ok(end <= b.length); const type = b.toString('ascii', offset + 4, offset + 8), data = b.subarray(offset + 8, end - 4); assert.equal(crc(b.subarray(offset + 4, end - 4)), b.readUInt32BE(end - 4), 'PNG CRC ' + type); if (type === 'IHDR') { assert.equal(header, undefined); assert.equal(length, 13); header = Buffer.from(data); } if (type === 'IDAT') streams.push(data); if (type === 'IEND') { assert.equal(length, 0); ended = true; offset = end; break; } offset = end; }
  assert.ok(header && ended && streams.length); assert.equal(offset, b.length);
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), channels = { 2: 3, 6: 4 }[header[9]];
  assert.ok(width > 0 && height > 0 && width * height < 100000000 && channels); assert.equal(header[8], 8); assert.equal(header[10], 0); assert.equal(header[11], 0); assert.equal(header[12], 0);
  const stride = width * channels, pixels = Buffer.alloc(stride * height), raw = inflateSync(Buffer.concat(streams), { maxOutputLength: (stride + 1) * height }); assert.equal(raw.length, (stride + 1) * height);
  let cursor = 0;
  for (let y = 0; y < height; y++) { const filter = raw[cursor++]; assert.ok(filter <= 4); for (let x = 0; x < stride; x++) { const i = y * stride + x, a = x >= channels ? pixels[i - channels] : 0, prior = y ? pixels[i - stride] : 0, corner = y && x >= channels ? pixels[i - stride - channels] : 0, p = a + prior - corner, pa = Math.abs(p - a), pb = Math.abs(p - prior), pc = Math.abs(p - corner); const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? prior : filter === 3 ? Math.floor((a + prior) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? prior : corner; pixels[i] = (raw[cursor++] + predictor) & 255; } }
  assert.equal(cursor, raw.length); return { width, height, channels, decodedBytes: pixels.length, decodedPixelsSha256: sha(pixels) };
}
function crc(b) { let c = 0xffffffff; for (const value of b) { c ^= value; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }

'use strict';
// Standalone, read-only archival verification. Never load archived code.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const base = __dirname;
const assert = (value, message) => { if (!value) throw new Error(message); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safe = rel => {
  assert(typeof rel === 'string' && rel.length && !rel.includes('\\') && !path.isAbsolute(rel), 'Unsafe archive path');
  assert(rel.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe archive segment');
  const target = path.join(base, rel);
  let cursor = base;
  for (const part of rel.split('/')) {
    cursor = path.join(cursor, part);
    assert(!fs.lstatSync(cursor).isSymbolicLink(), 'Archive symlink forbidden');
  }
  return target;
};
const read = rel => fs.readFileSync(safe(rel));
function decode(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) {
    assert(bytes.length % 2 === 0, 'Odd UTF16 JSON byte count');
    return {encoding:'UTF-16LE BOM', text:new TextDecoder('utf-16le', {fatal:true}).decode(bytes.subarray(2))};
  }
  const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191;
  return {encoding:bom ? 'UTF-8 BOM' : 'UTF-8', text:new TextDecoder('utf-8', {fatal:true}).decode(bom ? bytes.subarray(3) : bytes)};
}
const json = rel => JSON.parse(decode(read(rel)).text);
const same = (a,b,label) => assert(JSON.stringify(a) === JSON.stringify(b), label);
function walk(dir, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    assert(!entry.isSymbolicLink(), 'Archive symlink forbidden');
    const rel = prefix + entry.name;
    if (entry.isDirectory()) result.push(...walk(path.join(dir, entry.name), rel + '/'));
    else { assert(entry.isFile(), 'Nonregular archive entry'); result.push(rel); }
  }
  return result.sort();
}
function main() {
  assert(!fs.lstatSync(base).isSymbolicLink(), 'Archive root symlink forbidden');
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === '--current-source'), 'Usage: node verify.cjs [--current-source]');
  const closed = json('closed-allowlist.json');
  const actual = walk(base);
  same(actual, [...closed.files].sort(), 'Closed inventory differs');
  assert(new Set(closed.files).size === closed.files.length, 'Duplicate allowlist path');
  const seal = json('seal.json');
  assert(seal.schemaVersion === 1 && seal.verifiedCommit === null, 'Seal scope');
  assert(hash(read('file-index.json')) === seal.fileIndexSha256, 'File index seal mismatch');
  assert(hash(read('closed-allowlist.json')) === seal.closedAllowlistSha256, 'Allowlist seal mismatch');
  const index = json('file-index.json');
  same(index.files.map(p=>p.path).sort(),actual.filter(p=>!['file-index.json','seal.json'].includes(p)), 'File index coverage');
  for (const p of index.files) {
    const bytes = read(p.path);
    assert(bytes.length === p.bytes && hash(bytes) === p.sha256, 'File bytes/hash mismatch: ' + p.path);
  }
  assert(seal.totalFiles === actual.length && seal.indexedBytes === index.files.reduce((n,p)=>n+p.bytes,0), 'Seal totals');
  const c = json('input-contract.json');
  const pins = json('source-pins.json');
  assert(c.verifiedCommit === null && pins.verifiedCommit === null && c.rootNoReadinessDecision, 'No readiness promotion');
  assert(c.frozenHead === pins.frozenHead && c.frozenAppTree === pins.frozenAppTree, 'Frozen provenance');
  assert(c.frozenHead === 'cab95aa79d6b0ece4de541fa60c9d99805918a57' && c.frozenAppTree === '52a1d43790178ca6794fd5b682e3cad4bb0cb19c', 'Frozen pins');
  const payload = json('payload-index.json');
  same(payload.files, c.payloadCopies.map(({destination,bytes,sha256,group})=>({path:destination,bytes,sha256,group})), 'Payload contract coverage');
  assert(payload.files.length === 288 && payload.files.reduce((n,p)=>n+p.bytes,0) === 8002638, 'Payload accounting');
  const groups = {};
  for (const p of payload.files) {
    const bytes = read(p.path);
    assert(bytes.length === p.bytes && hash(bytes) === p.sha256, 'Payload raw mismatch');
    groups[p.group] = (groups[p.group] || 0) + 1;
  }
  same(groups,c.counts.groups,'Payload groups');
  assert(c.primaryInputs.length === 5, 'Primary index count');
  for (const p of c.primaryInputs) {
    const rel = 'input-indexes/' + p.name + '.json';
    const raw = read(rel);
    assert(raw.length === p.indexBytes && hash(raw) === p.sha256, 'Primary index identity');
    const j = json(rel), entries = Array.isArray(j.files) ? j.files : j.payloads;
    assert(Array.isArray(entries) && entries.length === p.fileCount, 'Primary index count');
    assert(entries.reduce((n,e)=>n+e.bytes,0) === p.bytes, 'Primary bytes');
    const expected = payload.files.filter(e=>e.group===p.name).map(e=>({path:e.path.slice(('payload/'+p.name+'/').length),bytes:e.bytes,sha256:e.sha256}));
    same(entries.map(e=>({path:e.path || e.file,bytes:e.bytes,sha256:e.sha256})).sort((a,b)=>a.path.localeCompare(b.path)), expected.sort((a,b)=>a.path.localeCompare(b.path)), 'Primary explicit coverage');
  }
  assert(pins.pins.length === 20, 'Source count');
  for (const p of pins.pins) {
    assert(p.clone === 'source/' + p.path + '.txt' && /^apps\/webapp\/src\/.+\.tsx?$/.test(p.path) && !p.path.split('/').includes('..'), 'Source clone mapping');
    const raw = read(p.clone);
    assert(raw.length === p.bytes && hash(raw) === p.sha256, 'Raw Git clone identity');
    new TextDecoder('utf-8',{fatal:true}).decode(raw);
    assert(crypto.createHash('sha1').update(Buffer.from('blob ' + raw.length + '\0')).update(raw).digest('hex') === p.gitBlob, 'Git blob SHA1');
  }
  const encodings = json('encoding-inventory.json');
  const expectedJson = [];
  for (const p of payload.files) {
    if (p.path.endsWith('.png')) continue;
    const raw = read(p.path), d = decode(raw);
    let parsed = false;
    try { JSON.parse(d.text); parsed = true; } catch (error) { assert(!p.path.endsWith('.json'), 'Invalid JSON: ' + p.path); }
    if (parsed) expectedJson.push({path:p.path,encoding:d.encoding,parse:'pass',extension:path.extname(p.path),bytes:raw.length,sha256:hash(raw)});
  }
  same(encodings.files,expectedJson,'Encoding inventory');
  assert(expectedJson.length === 191, 'JSON accounting');
  // Also parse every new JSON metadata/control file, with strict decoding.
  for (const rel of actual.filter(p=>p.endsWith('.json'))) json(rel);
  const summary = json('payload/root/bounded-summary.json');
  const t = summary.testAccounting;
  assert(summary.verifiedCommit === null && summary.finding.originalPublicCases.distinct === 8 && summary.finding.originalPublicCases.passed === 5 && summary.finding.originalPublicCases.failed === 3 && summary.finding.originalPublicCases.findings === 1, 'Inherited finding accounting');
  assert(summary.finding.rootExactAfterFix.currentPassed === 7 && summary.finding.rootExactAfterFix.unchangedBaselineFailed === 1 && summary.finding.rootExactAfterFix.overallGreen === false, 'Exact root run is not overall green');
  assert(t.fixtures.originalAssertionsRetained === 72 && t.fixtures.removed === 0 && t.fixtures.addedPublicEnabledButtonExpectation === 1 && t.fixtures.testNamesUnchanged, 'Fixture retention');
  const multiset = json('payload/independent/case-multiset.json');
  same(multiset.counts,{unit:203,unitFiles:14,pg:50,pgFiles:6,distinct:253,files:20},'Independent totals');
  assert(multiset.latest.length === 253 && new Set(multiset.latest.map(p=>JSON.stringify([p.file,p.fullName,p.occurrence]))).size === 253 && multiset.latest.every(p=>p.status==='passed'), 'Distinct passed cases');
  assert(new Set(multiset.latest.map(p=>p.file)).size === 20 && t.finalIndependent.overlapFrozen1748 === 172 && t.finalIndependent.rerunsNonadditive, 'Nonadditive scope');
  assert(t.finalIndependent.unit===203 && t.finalIndependent.unitFiles===14 && t.finalIndependent.postgres===50 && t.finalIndependent.postgresFiles===6 && t.finalIndependent.distinct===253 && t.finalIndependent.totalFiles===20, 'Root summary independent accounting');
  for(const [rel,total,passed,failed] of [
    ['payload/root/red.json',8,5,3],['payload/root/green-exact.json',8,7,1],
    ['payload/root/compatibility.json',183,178,5],['payload/root/compatibility-final.json',183,183,0],
    ['payload/independent/unit13.json',183,183,0],['payload/independent/priority-final.json',20,20,0],['payload/independent/pg6.json',50,50,0]
  ]) {const result=json(rel);assert(result.numTotalTests===total && result.numPassedTests===passed && result.numFailedTests===failed,'Raw test accounting: '+rel);}
  function ledger(rel, expected) {
    const j=json(rel), rows=j.product;
    assert(new Set(rows.map(p=>p.id)).size===22 && rows.length===22,'Runtime named IDs');
    const counts={total:22,PASS:0,FAIL:0,UNPASSED:0};
    for(const p of rows){assert(['PASS','FAIL','UNPASSED'].includes(p.state),'Disposition');counts[p.state]++;}
    same(counts,expected,'Runtime disposition totals');same(j.productUniqueFinalPredicates,expected,'Producer runtime totals');
  }
  ledger('payload/runtime-auth-stop/assertion-ledger.json',{total:22,PASS:0,FAIL:0,UNPASSED:22});
  ledger('payload/runtime-network/assertion-ledger.json',{total:22,PASS:15,FAIL:0,UNPASSED:7});
  const focus=json('payload/focused/predicate-ledger.json');
  assert(focus.assertions.length===14 && new Set(focus.assertions.map(p=>p.id)).size===14, 'Focused IDs');
  assert(focus.assertions.filter(p=>p.status==='PASS').length===7 && focus.assertions.filter(p=>p.status==='UNPASSED').length===7 && focus.assertions.filter(p=>p.status==='FAIL').length===0,'Focused narrow dispositions');
  assert(focus.assertions.filter(p=>/^F[1-7]$/.test(p.id)).every(p=>p.status==='PASS') && focus.assertions.find(p=>p.id==='F8').status==='UNPASSED','Focused optional stays unpassed');
  assert(summary.runtimeAccounting.noCombinedRuntimePassTotal && summary.runtimeAccounting.noNewUnitPgOrBuildCasesFromRuntime,'No combined acceptance');
  const f4=json('payload/focused/F4-direct-denial.json');
  assert(f4.pass===false && f4.httpStatus===200 && f4.renderedNotFound===true && f4.readback[0].is_active===false,'Preserve raw F4 HTTP200 rendered denial and harness failure');
  assert(json('payload/focused/capture-review.json').pixelAcceptance==='UNPASSED','Focused pixel qualification');
  assert(json('payload/root/quality-exits-final.json').ordinary===1,'Ordinary formatting remains failed');
  const historical=json('payload/native/inherited-stop/reconciliation.json').staticParsing.python;
  assert(historical.find(p=>p.path==='prepare-attempt3.py').astParse==='fail','Failed preparation retained');
  assert(summary.preservation.verifiedAnchorOccurrences===65 && summary.preservation.missingAnchors===0 && summary.preservation.prior1748ArchiveFiles===202,'Preservation scope');
  const currentDb=json('payload/native/runtime-network/audit.json').database;
  const focusedDb=json('payload/native/focused/audit.json').database;
  assert(currentDb.originalAliases.length===5 && currentDb.originalAliases.every(p=>p.same) && currentDb.unexpectedUiDeltas.length===0,'Current original preservation');
  same(currentDb.expectedUiDeltas.map(p=>[p.table,p.countDelta]),[['travel_expense_report',4],['travel_expense_report_item',2]],'Current UI deltas');
  assert(currentDb.populatedTimekeepingDigests.length===6 && currentDb.populatedTimekeepingDigests.every(p=>p.count>0&&p.same),'Current populated timekeeping');
  assert(focusedDb.originalAliasGroups===4 && focusedDb.originalAliases.every(p=>p.unchanged) && focusedDb.foreignNamespacePostSeedUnchanged,'Focused original preservation');
  same(focusedDb.postSeedUiDelta.map(p=>[p.table,p.countDelta]),[['expense_officer_grant',1],['travel_expense_report',2],['travel_expense_report_item',2]],'Focused UI deltas');
  assert(focusedDb.populatedTimekeepingPairs.length===6 && focusedDb.populatedTimekeepingPairs.every(p=>p.count>0&&p.unchanged),'Focused populated timekeeping');
  assert(focusedDb.exactFinalGrant.is_active===false && focusedDb.exactFinalGrant.can_export===false && focusedDb.exactFinalGrant.can_record_reimbursements===false,'Read-only grant final inactive');
  for(const group of ['runtime-auth-stop','runtime-network','focused']) {
    const release=json('payload/'+group+'/RELEASE.json');
    assert(release.ownership===false && release.ownedLiveResources===0,'Released runtime lease');
  }
  const pngs=json('png-validation.json').images;
  assert(pngs.length===5 && pngs.filter(p=>p.path.startsWith('payload/runtime-network/')).length===4,'PNG scope');
  same(pngs.map(p=>p.path).sort(),payload.files.filter(p=>p.path.endsWith('.png')).map(p=>p.path).sort(),'All and only allowlisted PNGs');
  for(const p of pngs){const raw=read(p.path);assert(hash(raw)===p.sha256 && raw.readUInt32BE(16)===p.width && raw.readUInt32BE(20)===p.height,'PNG bytes/dimensions');}
  const metadata=json('publication-metadata.json');
  const newMd=metadata.newMarkdown;
  for(const rel of newMd){
    const text=decode(read(rel)).text;
    for(const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
      const dest=match[1]; assert(!/^(?:https?:|mailto:|#)/.test(dest),'Unexpected external/anchor new Markdown link');
      const resolved=path.relative(base,path.resolve(base,path.dirname(rel),decodeURIComponent(dest))).split(path.sep).join('/');
      assert(closed.files.includes(resolved),'New Markdown link outside closed archive: '+dest);safe(resolved);
    }
  }
  const appendix=read(metadata.report.appendixFile);
  assert(appendix.length===metadata.report.appendixBytes && hash(appendix)===metadata.report.appendixSha256,'Appendix raw receipt');
  same(metadata.report.prefix,c.reportPrefix,'Original report prefix receipt');
  const appendixText=decode(appendix).text;
  assert(appendixText.startsWith('\n## Root bounded history and capability recovery proof\n'),'Exact appended section heading');
  for(const match of appendixText.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
    assert(match[1].startsWith(metadata.report.linkPrefix),'Unexpected appendix link');
    const rel=match[1].slice(metadata.report.linkPrefix.length);
    assert(closed.files.includes(rel),'Appendix local link missing');safe(rel);
  }
  let currentSource = 'not requested';
  if(args[0]==='--current-source'){
    const repository=path.resolve(base,'../../../../..');
    for(const p of pins.pins){
      let cursor=repository;
      for(const part of p.path.split('/')){cursor=path.join(cursor,part);assert(!fs.lstatSync(cursor).isSymbolicLink(),'Current source symlink forbidden');}
      const raw=fs.readFileSync(cursor), text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
      assert(hash(Buffer.from(text.replace(/\r\n/g,'\n'),'utf8'))===p.sha256,'Current source evolved: '+p.path);
    }
    currentSource='20/20 match after CRLF-to-LF only';
  }
  console.log(JSON.stringify({status:'PASS',scope:'bounded immutable archive; no readiness promotion',payloadFiles:288,payloadBytes:8002638,primaryIndexes:5,rawGitSourceClones:20,archiveFiles:actual.length,jsonPayloads:191,pngs:5,inheritedPublic:'5P/3F; one finding',rootExact:'7 current P + 1 baseline F; NOT overall green',independentDistinct:'253/20 files; overlap 172 nonadditive',runtimeV1:'0P/0F/22U',runtimeV2:'15P/0F/7U',focused:'F1-F7 narrow P; F8 + six broader/tooling/pixel U; not additive',verifiedCommit:null,currentSource},null,2));
}
try { main(); } catch(error) { console.error('ARCHIVE VERIFICATION FAILED: '+error.message); process.exitCode=1; }

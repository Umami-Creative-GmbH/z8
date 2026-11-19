'use strict';
// Read-only: built-in filesystem and crypto only. Never import archived code.
const fs = require('node:fs');
const crypto = require('node:crypto');
const base = __dirname;
const args = process.argv.slice(2);
const current = args.length === 1 && args[0] === '--current-source';
function assert(ok, message) { if (!ok) throw new Error(message); }
assert(args.length === 0 || current, 'Only --current-source is supported');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const blob = b => crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
function safe(p) {
  assert(typeof p === 'string' && p.length > 0 && !p.includes('\\') && !p.includes(':') && !p.startsWith('/') && p.split('/').every(x => x && x !== '.' && x !== '..'), 'Unsafe archive path');
  let walk = base;
  for (const part of p.split('/')) { walk += '/' + part; assert(!fs.lstatSync(walk).isSymbolicLink(), 'Symlink is not an archive file'); }
  return walk;
}
const read = p => fs.readFileSync(safe(p));
const json = p => JSON.parse(read(p).toString('utf8'));
function match(p, r) { const b = read(p); assert(b.length === r.bytes && sha(b) === r.sha256, `Byte identity mismatch: ${p}`); return b; }
function equal(a,b,m) { assert(JSON.stringify(a) === JSON.stringify(b), m); }
function unique(rows, key, label) { assert(new Set(rows.map(x => x[key])).size === rows.length, `Duplicate ${label}`); }
function walk(dir, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    assert(!e.isSymbolicLink(), 'Archive contains symlink');
    const p = prefix + e.name;
    if (e.isDirectory()) out.push(...walk(dir + '/' + e.name, p + '/'));
    else { assert(e.isFile(), 'Non-regular archive entry'); out.push(p); }
  }
  return out.sort();
}
try {
  assert(sha(read('input-contract.json')) === '2e38a63847ac02cbb506d2c8316fbc4e5e4fd8510f274250b1ce9c4e8390c05e', 'Input contract anchor mismatch');
  const c = json('input-contract.json'), pi = json('payload-index.json'), sp = json('source-pins.json'), fi = json('file-index.json'), seal = json('publication-seal.json'), d = json('claim-dispositions.json');
  for (const x of [c, pi, sp, fi, seal, d]) assert(x.verifiedCommit === null, 'verifiedCommit must remain null');
  assert(c.head === '3a3c1243147d92213ffde7ffe423e3da67ecd011' && c.appTree === '1f82885d26e402a0d01556ea7005adba092e9cff', 'Frozen identity mismatch');
  assert(sp.frozenHead === c.head && sp.frozenAppTree === c.appTree && seal.frozenHead === c.head && seal.frozenAppTree === c.appTree, 'Pin/seal identity mismatch');
  assert(pi.contractSha256 === sha(read('input-contract.json')) && seal.contractSha256 === pi.contractSha256, 'Contract reference mismatch');
  equal(seal.reportPrefix, c.reportPrefix, 'Report prefix contract mismatch');
  match('file-index.json', seal.fileIndex);
  match('payload-index.json', seal.payloadIndex);
  match('source-pins.json', seal.sourcePins);
  unique(fi.files, 'path', 'file index path');
  equal(walk(base), [...fi.files.map(x => x.path), 'file-index.json', 'publication-seal.json'].sort(), 'Unindexed or missing archive files');
  for (const f of fi.files) match(f.path, f);
  equal(pi.files, c.payloads, 'Payload index differs from exact contract');
  assert(pi.count === 172 && pi.bytes === 2297645 && pi.files.length === 172, 'Payload total mismatch');
  const counts = {}, totals = {};
  for (const p of pi.files) {
    match(p.destination,p); counts[p.group] = (counts[p.group] || 0) + 1; totals[p.group] = (totals[p.group] || 0) + p.bytes;
  }
  equal(counts, {'detail-stop':11,'conversion-stop':21,independent:61,runtime:34,focused:36,'intake-audits':6,'root-checks':3}, 'Cohort counts mismatch');
  assert(Object.values(totals).reduce((a,b)=>a+b,0) === pi.bytes && totals.independent === 761942, 'Cohort bytes mismatch');
  for (const i of c.inputIndexes) {
    const b = read('input-indexes/' + i.id + '.json'); assert(sha(b) === i.sha256, 'Input index mismatch');
    const files = JSON.parse(b.toString('utf8')).files;
    assert(files.length === i.payloadCount, 'Input index count mismatch');
    const key = (name, x) => `${name}|${x.bytes}|${x.sha256}`;
    equal(files.map(f => key((f.path || f.file).replace(/\\/g,'/').split('/').pop(),f)).sort(), c.payloads.filter(p => p.group === i.id).map(p => key(p.destination.split('/').pop(),p)).sort(), 'Input membership mismatch');
  }
  assert(sp.pins.length === 14 && c.sourcePins.length === 14, 'Source pin count mismatch');
  unique(sp.pins, 'path', 'source path');
  for (const [n,p] of sp.pins.entries()) {
    const frozen = c.sourcePins[n];
    for (const k of ['path','clone','bytes','sha256','gitBlob']) assert(p[k] === frozen[k], 'Source pin contract mismatch');
    const b = match(p.clone,p); assert(blob(b) === p.gitBlob && p.canonicalGitBlob === p.gitBlob, 'Source Git blob mismatch');
    assert(p.currentCanonical.bytes === p.bytes && p.currentCanonical.sha256 === p.sha256, 'Publication current canonical mismatch');
    if (current) {
      assert(p.path.startsWith('apps/webapp/') && !p.path.includes('..'), 'Unsafe current source path');
      const actual = fs.readFileSync(base + '/../../../../../' + p.path);
      const canonical = Buffer.from(actual.toString('utf8').replace(/\r\n/g,'\n'));
      assert(canonical.equals(b) && blob(canonical) === p.gitBlob, `Current canonical source drift: ${p.path}`);
    }
  }
  const a = json('runtime/assertion-ledger-SAFE.json').assertions;
  assert(a.length === 140 && a.every(x => x.result === 'PASS'), 'Generation A ledger mismatch');
  unique(a,'id','generation A ID'); unique(a,'name','generation A name');
  const categories = {}; for (const x of a) categories[x.category] = (categories[x.category] || 0) + 1;
  equal(Object.entries(categories).sort(), Object.entries({runtime:46,'source/resource preservation':6,'database-readback/preservation':88}).sort(), 'Generation A category mismatch');
  const old = d.generationA.rootDispositions;
  equal(old.map(x=>[x.id,x.disposition]), [[42,'unsupported'],[16,'narrowed']], 'Old claim dispositions missing');
  assert(d.generationA.declaredPass === 140 && d.generationA.acceptedIndependentPassCount === null, 'Generation A overclaim');
  for (const claim of old) for (const target of claim.evidence) assert(fs.statSync(safe(target)).isFile(), 'Disposition evidence link missing');
  const f = json('focused/assertion-ledger-SAFE.json').assertions;
  assert(f.length === 32 && f.filter(x=>x.result==='PASS').length === 29, 'Focused count mismatch');
  unique(f,'id','focused ID'); unique(f,'name','focused name');
  equal(f.filter(x=>x.result!=='PASS').map(x=>x.id), [13,14,28], 'Focused UNPASSED IDs mismatch');
  equal(d.generationB.unpassedIds,[13,14,28],'Focused dispositions mismatch');
  assert(d.generationB.passed === 29 && d.generationB.total === 32 && d.generationB.successfulRetiredCompletionProved === false && d.generationB.oldClaimsRetroactivelyChanged === false, 'Focused qualification mismatch');
  const multi = json('independent/test-multiset.json');
  const unit = multi.latest.filter(x=>!x.file.includes('.integration.test.')), pg = multi.latest.filter(x=>x.file.includes('.integration.test.'));
  assert(unit.length === 545 && new Set(unit.map(x=>x.file)).size === 48 && pg.length === 51 && new Set(pg.map(x=>x.file)).size === 4 && multi.latest.every(x=>x.status==='passed'), 'Independent multiset mismatch');
  unique(multi.latest.map(x=>({key:`${x.file}\0${x.fullName}\0${x.occurrence}`})),'key','test identity');
  const dl = json('runtime/download-SAFE.json');
  assert(dl.completed && dl.bytes === 68 && dl.width === 1 && dl.height === 1 && dl.sha256 === '6b1048f8a6d40bac0b2954c18fefa40c4ea7a96120fc2e54b7317c0e43c2bbec', 'Download producer receipt mismatch');
  assert(d.generationB.foreignTravelTables === 29 && d.generationB.foreignTravelAllEmpty && d.generationB.newMoneyActions === 0 && d.noCombinedCoverageCount && d.rootOwnsReadiness, 'Semantic limits missing');
  for (const g of ['runtime','focused']) assert(json(g + '/lease-release-SAFE.json').ownership === false, 'Runtime lease not released');
  let jsonCount = 0;
  for (const p of walk(base)) if (p.endsWith('.json')) { json(p); jsonCount++; }
  let links = 0;
  const md = read('README.md').toString('utf8').replace(/```[\s\S]*?```/g,'');
  for (const m of md.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = m[1].split('#')[0]; if (!target || /^[a-z]+:/i.test(target)) continue;
    assert(fs.statSync(safe(decodeURIComponent(target))).isFile(), 'New Markdown link missing'); links++;
  }
  const appendix = read('report-appendix.txt').toString('utf8');
  assert(appendix.split('## ' + c.appendixTitle).length === 2, 'Named appendix missing or repeated');
  for (const m of appendix.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const prefix = '1748/root-withdrawal-and-continuation/';
    assert(m[1].startsWith(prefix), 'Unexpected new appendix link');
    assert(fs.statSync(safe(m[1].slice(prefix.length))).isFile(), 'Appendix archive link missing'); links++;
  }
  assert(sha(read('report-appendix.txt')) === seal.reportAppendix.sha256 && read('report-appendix.txt').length === seal.reportAppendix.bytes, 'Appendix receipt mismatch');
  assert(seal.fullReportAtPublication.bytes === c.reportPrefix.bytes + seal.reportAppendix.bytes, 'Full report byte receipt mismatch');
  console.log(JSON.stringify({status:'PASS',mode:current?'current-source':'archive',payloads:172,payloadBytes:2297645,sourceClones:14,currentSources:current?14:0,archiveFiles:walk(base).length,jsonParsed:jsonCount,newMarkdownLinks:links,generationADeclared:140,generationARootDispositions:{unsupported:[42],narrowed:[16]},focused:{passed:29,total:32,unpassed:[13,14,28]},unitIdentities:545,unitFiles:48,pgCases:51,pgFiles:4,verifiedCommit:null}));
} catch (e) { console.error('FAIL: ' + e.message); process.exitCode = 1; }

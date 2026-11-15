import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import {join} from 'node:path';
const root='docs/design/rollout-1692/1725';
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]))).flat()}
const paths=await files(root);for(const path of paths.filter(p=>p.endsWith('.json')))JSON.parse(await readFile(path,'utf8'));
const doc=await readFile(root+'.md','utf8');let links=0;for(const m of doc.matchAll(/\]\((1725\/[^)#]+)(?:#[^)]*)?\)/g)){await access(join('docs/design/rollout-1692',m[1]));links++;}
const scope=JSON.parse(await readFile(root+'/scope/checks.json','utf8'));assert.ok(scope.checks.some(c=>c.action?.functionName==='startScopedPayrollExportAction'));assert.ok(scope.checks.some(c=>c.name==='A return settles with one Payroll heading and eight authorized employee rows'));
const evidence=JSON.parse(await readFile(root+'/evidence-verification.json','utf8'));assert.equal(evidence.passed,true);const delta=evidence.latestMetadataDelta.split('\n').filter(l=>/^[+-]/.test(l)&&!/^\+\+\+|^---/.test(l));assert.deepEqual(delta,['+\t\tpath === "/organization" ||']);
console.log(`Parsed ${paths.filter(p=>p.endsWith('.json')).length} JSON records; resolved ${links} report links; verified named export owner, settled A return, and independent organization-only metadata delta.`);

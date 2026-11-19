// Read-only final script syntax, document links and branch ancestry check. Explicit checkout.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
const repo=resolve(process.argv[2]),dir=join(repo,'docs/design/rollout-1692/1827');
const scripts=(await readdir(dir)).filter(p=>p.endsWith('.mjs'));
for(const script of scripts)execFileSync(process.execPath,['--check',join(dir,script)],{windowsHide:true});
const doc=join(repo,'docs/design/rollout-1692/1827.md');let links=0;
for(const match of (await readFile(doc,'utf8')).matchAll(/\]\(([^)]+)\)/g)){if(match[1].startsWith('http'))continue;assert.ok(existsSync(resolve(dirname(doc),match[1])),match[1]);links++;}
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true}).trim();
const local=git('rev-parse','ai/1692-app-wide-ui-refresh');assert.equal(git('merge-base','HEAD',local),local);
console.log(JSON.stringify({syntaxCheckedScripts:scripts.length,resolvedDocumentLinks:links,latestLocalAncestor:local}));

// Close only isolated Puppeteer browsers whose top-level tabs belong to this owned runtime.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]);
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
const raw=execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'puppeteer_dev_chrome_profile-' -and $_.CommandLine -match '--remote-debugging-port=0' -and $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}).trim();
const parsed=raw?JSON.parse(raw):[],processes=Array.isArray(parsed)?parsed:[parsed];let closed=0;
for(const p of processes){
 const match=p.CommandLine.match(/--user-data-dir=(?:"([^"]+)"|([^\s]+))/);if(!match)continue;
 const profile=resolve(match[1]??match[2]);
 if(dirname(profile).toLowerCase()!==resolve(tmpdir()).toLowerCase()||!basename(profile).startsWith('puppeteer_dev_chrome_profile-'))continue;
 let browser;
 try{
  const [port,path]=String(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);assert.match(port,/^\d+$/);
  browser=await puppeteer.connect({browserWSEndpoint:'ws://127.0.0.1:'+port+path});
  const urls=await Promise.all((await browser.pages()).map(p=>p.url()));
  if(!urls.some(u=>u.startsWith(runtime.origin+'/'))||!urls.every(u=>u==='about:blank'||u.startsWith(runtime.origin+'/'))){browser.disconnect();continue;}
  await browser.close();closed++;
 }catch{browser?.disconnect();}
}
console.log('Closed '+closed+' exclusively owned runtime browsers.');

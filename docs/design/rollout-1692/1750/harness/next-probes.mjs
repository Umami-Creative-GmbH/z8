import {writeFile} from 'node:fs/promises';
const output='docs/design/rollout-1692/1750/next-probes.json';
const results={source:'7e466fae2668148a856b6dfb2fdaf605d7366029',origin:'owned loopback development server',privacyClone:true};
for(const name of ['get_project_metadata','get_page_metadata','get_errors','get_compilation_issues']) {
 try {
  const response=await fetch('http://localhost:62904/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:name,method:'tools/call',params:{name,arguments:{}}}),signal:AbortSignal.timeout(55000)});
  const text=await response.text();
  const data=text.split(/\r?\n/).filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
  results[name]={http:response.status,data};
 }catch(e){results[name]={unpassed:true,message:e.message};}
 await writeFile(output,JSON.stringify(results,null,2).replace(/[^\s"<>@]+@[^\s"<>@]+\.[^\s"<>@]+/g,'[contact removed]'));
}
console.log('Next probes recorded, including any failures.');

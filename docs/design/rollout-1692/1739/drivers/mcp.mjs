import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const {directory}=JSON.parse(readFileSync(new URL('./private-pointer.json',import.meta.url)));
const {origin}=JSON.parse(readFileSync(join(directory,'runtime-private.json')));
let id=0;
async function call(method,params){
 const response=await fetch(`${origin}/_next/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
 const raw=await response.text();writeFileSync(`.tmp/1739-checks/mcp-${id}.raw`,raw);
 const line=raw.split(/\r?\n/).find(x=>x.startsWith('data: '));
 return JSON.parse(line?line.slice(6):raw);
}
const list=await call('tools/list',{});
writeFileSync('docs/design/rollout-1692/1739/next-tools.json',JSON.stringify(list,null,2));
const names=list.result.tools.map(x=>x.name);if(!names.includes('get_compilation_issues'))throw Error('Next dev loop preflight failed');
const results={};
for(const name of ['get_compilation_issues','get_routes','get_errors','get_page_metadata'])results[name]=await call('tools/call',{name,arguments:{}});
writeFileSync('docs/design/rollout-1692/1739/next.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.get_compilation_issues));

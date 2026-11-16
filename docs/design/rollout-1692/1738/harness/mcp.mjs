import {readFile,writeFile} from 'node:fs/promises';
const r=JSON.parse(await readFile('.tmp/1738/private/runtime-private.json','utf8'));
for(const name of ['tools/list','get_compilation_issues','get_routes','get_errors']){
 const payload={jsonrpc:'2.0',id:1,method:name==='tools/list'?name:'tools/call',...(name==='tools/list'?{}:{params:{name,arguments:{}}})};
 const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:JSON.stringify(payload)});
 await writeFile(`docs/design/rollout-1692/1738/mcp-${name.replace('/','-')}.txt`,await response.text());console.log(name,response.status);
}

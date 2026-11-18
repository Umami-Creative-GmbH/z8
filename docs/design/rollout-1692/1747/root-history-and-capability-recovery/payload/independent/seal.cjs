const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const base=__dirname;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const excluded=new Set(['SHA256.json','seal.json']);
function walk(dir,prefix=''){
 const out=[];
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(e.isSymbolicLink())throw Error('Unsafe symlink');
  const p=prefix+e.name;
  if(e.isDirectory())out.push(...walk(path.join(dir,e.name),p+'/'));
  else if(e.isFile()&&!excluded.has(p))out.push(p);
  else if(!e.isFile())throw Error('Non-file');
 }
 return out.sort();
}
const files=walk(base).map(p=>{const b=fs.readFileSync(path.join(base,p));return {path:p,bytes:b.length,sha256:sha(b)};});
const index={schemaVersion:1,verifiedCommit:null,frozenHead:'cab95aa79d6b0ece4de541fa60c9d99805918a57',appTree:'52a1d43790178ca6794fd5b682e3cad4bb0cb19c',fileCount:files.length,payloadBytes:files.reduce((n,f)=>n+f.bytes,0),files};
fs.writeFileSync(path.join(base,'SHA256.json'),JSON.stringify(index,null,2)+'\n');
const b=fs.readFileSync(path.join(base,'SHA256.json'));
const seal={schemaVersion:1,verifiedCommit:null,index:{path:'SHA256.json',bytes:b.length,sha256:sha(b)},payloadFiles:index.fileCount,payloadBytes:index.payloadBytes,controlFiles:['SHA256.json','seal.json'],totalFiles:index.fileCount+2,qualification:'Payload allowlist includes sanitized synthetic tests, logs/results, scripts, immutable source snapshots and failed attempts; no env/browser/session/credential artifacts. Control files are detached from payload index to avoid self-hash cycles.'};
fs.writeFileSync(path.join(base,'seal.json'),JSON.stringify(seal,null,2)+'\n');
console.log(JSON.stringify({...seal,sealSha256:sha(fs.readFileSync(path.join(base,'seal.json')))}));

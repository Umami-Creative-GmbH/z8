const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const names=['HANDOFF.md','audit.cjs','bridge.cjs','browser-upload.config.mts','cold-cache.cjs','minimize.cjs','results.cjs','summarize.cjs','seal.cjs','public-surrounding.test.tsx','upload-review.test.tsx','workspace-recovery-v1.test.tsx','workspace-recovery.test.tsx','candidate-audit.json','results.json','resource-seal.json'];
const digest=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const entries=names.map(name=>{const b=fs.readFileSync(path.join(__dirname,name));return {path:name,bytes:b.length,sha256:digest(b)}});
const allow={root:__dirname,scope:'SAFE synthetic source/results/source-config pins and ownership metadata only. Private raw logs/JSON/auth/profile/controller/bodies/inventories/failure images excluded.',files:entries};
const body=JSON.stringify(allow,null,2)+'\n';fs.writeFileSync(path.join(__dirname,'safe-allowlist.json'),body);
fs.writeFileSync(path.join(__dirname,'SHA256SUMS.txt'),[...entries.map(e=>`${e.sha256}  ${e.path}`),`${digest(Buffer.from(body))}  safe-allowlist.json`].join('\n')+'\n');
for(const e of entries)if(digest(fs.readFileSync(path.join(__dirname,e.path)))!==e.sha256)throw Error('Seal verification failed');
console.log(JSON.stringify({safeFiles:entries.length,allowlistSha256:digest(Buffer.from(body)),verified:true}));

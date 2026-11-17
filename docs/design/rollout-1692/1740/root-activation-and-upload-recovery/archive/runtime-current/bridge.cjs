const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const target=path.join(root,'apps/webapp/src/test/1740-availability-independent-bridge.test.tsx');
const manifest=path.join(__dirname,'bridge.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const [action,input]=process.argv.slice(2);
if(action==='write'){
 if(fs.existsSync(target))throw Error('Bridge already exists');
 const bytes=fs.readFileSync(path.join(__dirname,input));fs.writeFileSync(target,bytes,{flag:'wx'});
 fs.writeFileSync(manifest,JSON.stringify({input,path:target,sha256:hash(bytes)},null,2));
}else if(action==='remove'){
 const m=JSON.parse(fs.readFileSync(manifest));if(m.path!==target||hash(fs.readFileSync(target))!==m.sha256)throw Error('Bridge guard mismatch');
 fs.unlinkSync(target);fs.writeFileSync(path.join(__dirname,'bridge-removal.json'),JSON.stringify({...m,removed:true},null,2));
}else throw Error('Expected write or remove');

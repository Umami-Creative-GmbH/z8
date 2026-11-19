const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const base=__dirname;const bridge=path.resolve(base,'../../apps/webapp/src/test/1740-activation-independent-bridge.test.tsx');const hashFile=path.join(base,'bridge-hash.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const mode=process.argv[2];
if(fs.existsSync(bridge)){
  const prior=JSON.parse(fs.readFileSync(hashFile));if(hash(fs.readFileSync(bridge))!==prior.sha256)throw Error('Bridge changed; refusing overwrite/removal');
  fs.unlinkSync(bridge);
}
if(mode==='write'){
  const bytes=fs.readFileSync(path.join(base,process.argv[3]||'public-acceptance.test.tsx'));fs.writeFileSync(bridge,bytes,{flag:'wx'});fs.writeFileSync(hashFile,JSON.stringify({path:bridge,sha256:hash(bytes)},null,2));
}
console.log(JSON.stringify({bridgePresent:fs.existsSync(bridge),mode}));

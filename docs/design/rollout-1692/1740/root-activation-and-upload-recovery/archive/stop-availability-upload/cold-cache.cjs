const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');const target=path.join(root,'apps/webapp/node_modules/.vite');
if(fs.existsSync(target)){
 const real=fs.realpathSync(target);const stat=fs.lstatSync(target);
 if(real!==target||stat.isSymbolicLink()||!target.startsWith(root+path.sep))throw Error('Cache is not exact owned physical path');
 fs.rmSync(target,{recursive:true});console.log('Removed exact owned physical Vitest cache');
}else console.log('No owned Vitest cache present');

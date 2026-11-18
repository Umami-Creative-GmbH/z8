const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const root=process.cwd();
const appRequire=createRequire(path.join(root,'apps/webapp/package.json'));
const parser=require(path.join(root,'node_modules/.pnpm/node_modules/@babel/parser'));
const parserVersion=require(path.join(root,'node_modules/.pnpm/node_modules/@babel/parser/package.json')).version;
const safe=path.join(root,'.tmp/review1748-both/SAFE');
const selection=JSON.parse(fs.readFileSync(path.join(safe,'selection.json')));
const files=[...selection.quality,...fs.readdirSync(safe).filter(x=>x.endsWith('.tsx')||x.endsWith('.tsx.txt')).map(x=>path.relative(root,path.join(safe,x)))];
const checks=files.map(file=>{
 const text=fs.readFileSync(file,'utf8');
 let diagnostics=[];
 try { parser.parse(text,{sourceType:'unambiguous',plugins:['typescript','jsx']}); }
 catch(error) { diagnostics=[{message:error.message}]; }
 return {path:file,parser:'@babel/parser '+parserVersion,diagnostics};
});
fs.writeFileSync(path.join(safe,'syntax.json'),JSON.stringify({mode:'parse only; never executing archived source',checks},null,2));
if(checks.some(x=>x.diagnostics.length)) process.exitCode=1;
console.log(JSON.stringify({files:checks.length,diagnostics:checks.reduce((n,x)=>n+x.diagnostics.length,0)}));

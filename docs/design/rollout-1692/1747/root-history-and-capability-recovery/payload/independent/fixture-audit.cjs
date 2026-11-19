const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const parser=require(path.join(process.cwd(),'node_modules/.pnpm/@babel+parser@7.29.9/node_modules/@babel/parser'));
const base='c70858bfe507eb99f844a455230e312cc8247b61';
function extract(source){
 const file=parser.parse(source,{sourceType:'module',plugins:['typescript','jsx']});
 const assertions=[],names=[];
 function visit(n,ancestors=[]){
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='expect'){
   let top=n;for(const parent of ancestors.slice().reverse()){if(!['MemberExpression','CallExpression'].includes(parent.type))break;top=parent;}
   assertions.push(source.slice(top.start,top.end).replace(/\s+/g,' '));
  }
  if(n.type==='CallExpression'&&n.arguments[0]?.type==='StringLiteral'&&/^it(?:\.|\(|$)/.test(source.slice(n.callee.start,n.callee.end)))names.push(n.arguments[0].value);
  for(const [k,value] of Object.entries(n)) {
   if(['loc','tokens','comments','errors'].includes(k))continue;
   if(Array.isArray(value))for(const child of value){if(child&&typeof child.type==='string')visit(child,[...ancestors,n]);}
   else if(value&&typeof value.type==='string')visit(value,[...ancestors,n]);
  }
 }
 visit(file);return {assertions,names,parseErrors:0};
}
const results=[];
for(const name of ['legacy-draft-conversion-consumers.test.tsx','travel-expense-management.test.tsx']){
 const p='apps/webapp/src/components/travel-expenses/'+name;
 const old=extract(cp.execFileSync('git',['show',base+':'+p],{encoding:'utf8'})),current=extract(fs.readFileSync(p,'utf8'));
 const rest=current.assertions.slice(),removed=[];
 for(const a of old.assertions){const i=rest.indexOf(a);if(i<0)removed.push(a);else rest.splice(i,1);}
 const namesUnchanged=JSON.stringify(old.names)===JSON.stringify(current.names);
 if(removed.length||!namesUnchanged||old.parseErrors||current.parseErrors)throw Error('Fixture assertion changed '+name);
 results.push({path:p,beforeAssertions:old.assertions.length,afterAssertions:current.assertions.length,removed,added:rest,namesUnchanged,testNames:current.names});
}
fs.writeFileSync('.tmp/r165-independent-SAFE/fixture-reconciliation.json',JSON.stringify({base,results,qualification:'AST textual assertion-chain multiset comparison; no execution of baseline fixtures and no claim of live session authorization.'},null,2)+'\n');
console.log(JSON.stringify(results.map(({path,beforeAssertions,afterAssertions,namesUnchanged,removed})=>({path,beforeAssertions,afterAssertions,namesUnchanged,removed:removed.length}))));

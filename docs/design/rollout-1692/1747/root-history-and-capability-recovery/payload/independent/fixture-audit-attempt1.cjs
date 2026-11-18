const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const ts=require(path.join(process.cwd(),'apps/webapp/node_modules/typescript'));
const base='c70858bfe507eb99f844a455230e312cc8247b61';
function extract(source){
 const file=ts.createSourceFile('fixture.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const assertions=[],names=[];
 function visit(n){
  if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='expect'){
   let top=n;while(top.parent&&(ts.isPropertyAccessExpression(top.parent)||ts.isCallExpression(top.parent)))top=top.parent;
   assertions.push(top.getText(file).replace(/\s+/g,' '));
  }
  if(ts.isCallExpression(n)&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])&&/^it(?:\.|\(|$)/.test(n.expression.getText(file)))names.push(n.arguments[0].text);
  ts.forEachChild(n,visit);
 }
 visit(file);return {assertions,names,parseErrors:file.parseDiagnostics.length};
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

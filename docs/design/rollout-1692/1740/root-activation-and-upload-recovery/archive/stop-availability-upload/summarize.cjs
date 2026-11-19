const fs=require('node:fs');
for(const name of process.argv.slice(2)){
 const j=JSON.parse(fs.readFileSync(`${__dirname}/${name}`));
 const cases=j.testResults.flatMap(f=>f.assertionResults.map(a=>({file:f.name.split('/').pop().split('\\').pop(),name:a.fullName,status:a.status,failures:a.failureMessages.map(s=>s.replace(/\x1b\[[0-9;]*m/g,'').slice(0,800))})));
 console.log(JSON.stringify({result:name,counts:{passed:cases.filter(a=>a.status==='passed').length,failed:cases.filter(a=>a.status==='failed').length,pending:cases.filter(a=>a.status==='pending').length},cases},null,2));
}

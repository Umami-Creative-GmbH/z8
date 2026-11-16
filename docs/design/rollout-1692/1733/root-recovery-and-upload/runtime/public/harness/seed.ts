import{readFile,writeFile}from'node:fs/promises';import{join}from'node:path';import{verifySuiteDatabase,integrationAdminPool,closeIntegrationPools}from'@/test/integration-database';
async function main(){const dir=process.argv[2];const f=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));if(f.kind!=='disposable')throw Error('Disposable only');await verifySuiteDatabase();const p=integrationAdminPool();try{
const org=f.actors['small-admin'].organizationId;
await p.query('update employee set employee_number=$1 where id=$2 and organization_id=$3',['100',f.actors['small-employee'].employeeId,org]);
await p.query('update employee set employee_number=$1 where id=$2 and organization_id=$3',['200',f.actors['small-manager'].employeeId,org]);
const rows=(await p.query('select id from employee where organization_id=$1 and id<>all($2::uuid[]) order by id limit 2',[org,[f.actors['small-admin'].employeeId,f.actors['small-manager'].employeeId,f.actors['small-employee'].employeeId]])).rows;
for(const[i,r]of rows.entries())await p.query('update employee set employee_number=$1 where id=$2 and organization_id=$3',[String(300+i*100),r.id,org]);
await writeFile(join(dir,'initial-domain-private.json'),JSON.stringify({org,employee:f.actors['small-employee'].employeeId,numbers:['100','200','300','400'],authMembershipGrantWrites:false}));
console.log('Guarded initial personnel-number prerequisites seeded; no auth, membership, or grants changed.');
}finally{await closeIntegrationPools();}}main().catch(()=>{console.error('Initial domain setup failed; inspect owned private log.');process.exitCode=1;});

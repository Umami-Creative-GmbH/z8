import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {db,pool} from '@/db';
import {systemClock} from '@/lib/datetime/temporal-core';
import {createClocking} from '@/lib/time-tracking/clocking/clocking';
import {coordinatedTransactions} from '@/lib/time-tracking/clocking/transactions';
import {recordingFollowUps} from '@/lib/time-tracking/clocking/follow-ups';
async function main(){
const dir=resolve('../../.tmp/1744/fixture');
const f=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
assert.equal(f.kind,'disposable');
assert.match(process.env.POSTGRES_DB!,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(process.env.POSTGRES_HOST,'127.0.0.1');
const owner=f.actors['small-admin'];
const ownUser=(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[owner.employeeId,owner.organizationId])).rows[0]?.user_id;
assert.ok(ownUser);
let record;
try{record=JSON.parse(await readFile(join(dir,'presence-private.json'),'utf8'));}catch{}
if(!record){
 const active=randomUUID(),empty=randomUUID();
 for(const[id,name]of[[active,'Berlin workshop'],[empty,'Empty workshop']])await pool.query('insert into location(id,organization_id,name,is_active,created_by,updated_at) values($1,$2,$3,true,$4,now())',[id,owner.organizationId,name,ownUser]);
 const people=(await pool.query('select id,user_id from employee where organization_id=$1 order by id',[owner.organizationId])).rows;
 for(const person of people)await pool.query('insert into employee_assigned_location(organization_id,employee_id,location_id) values($1,$2,$3)',[owner.organizationId,person.id,active]);
 record={active,empty,organizationId:owner.organizationId,workers:['small-employee','small-restricted'],at:systemClock.nowInstant().toString()};
 await writeFile(join(dir,'presence-private.json'),JSON.stringify(record));
 const clock=createClocking({clock:systemClock,transactions:coordinatedTransactions(),followUps:recordingFollowUps()});
 for(const key of record.workers){const actor=f.actors[key],user=(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[actor.employeeId,actor.organizationId])).rows[0].user_id;
 const command={organizationId:actor.organizationId,principal:{kind:'user' as const,userId:user},subject:{employeeId:actor.employeeId},identity:{origin:'client' as const,id:randomUUID()},channel:'web' as const,at:{kind:'now' as const},zone:{device:'Europe/Berlin',fallback:'UTC'}};
 const result=await clock.run({...command,body:{kind:'clock_in',workLocationType:'office'}});assert.equal(result.outcome,'executed');
 if(key==='small-restricted')assert.equal((await clock.startBreak({...command,identity:{origin:'client',id:randomUUID()}})).outcome,'executed');
 }
}
console.log('Own assigned location plus empty location prepared; live work/break through canonical Clocking.');
await pool.end();

}
main().catch(error=>{console.error(error);process.exit(1)});

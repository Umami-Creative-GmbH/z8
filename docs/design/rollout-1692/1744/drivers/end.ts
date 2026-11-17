import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pool} from '@/db';
import {systemClock} from '@/lib/datetime/temporal-core';
import {createClocking} from '@/lib/time-tracking/clocking/clocking';
import {coordinatedTransactions} from '@/lib/time-tracking/clocking/transactions';
import {recordingFollowUps} from '@/lib/time-tracking/clocking/follow-ups';
async function main(){
assert.match(process.env.POSTGRES_DB!,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(process.env.POSTGRES_HOST,'127.0.0.1');
const f=JSON.parse(await readFile('../../.tmp/1744/fixture/fixture-private.json','utf8'));assert.equal(f.kind,'disposable');const a=f.actors['small-employee'];
const user=(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId])).rows[0]?.user_id;assert.ok(user);
const clock=createClocking({clock:systemClock,transactions:coordinatedTransactions(),followUps:recordingFollowUps()});
const result=await clock.run({organizationId:a.organizationId,principal:{kind:'user',userId:user},subject:{employeeId:a.employeeId},identity:{origin:'client',id:randomUUID()},channel:'web',at:{kind:'now'},zone:{device:'Europe/Berlin',fallback:'UTC'},body:{kind:'clock_out',project:{kind:'preserve'},workCategory:{kind:'preserve'}}});assert.equal(result.outcome,'executed');await pool.end();console.log('Canonical own-fixture working employee clocked out.');
}
main().catch(error=>{console.error(error);process.exit(1)});

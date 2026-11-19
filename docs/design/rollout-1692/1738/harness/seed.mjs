import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const require=createRequire(resolve('apps/webapp/package.json'));
const r=JSON.parse(await readFile('.tmp/1738/private/runtime-private.json','utf8'));
const f=JSON.parse(await readFile('.tmp/1738/private/fixture-private.json','utf8'));
const {Client}=require('pg');
const p=new Client({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await p.connect();
for(const prefix of ['small','large']) {
 const a=f.actors[`${prefix}-admin`], e=f.actors[`${prefix}-employee`];
 if(!a||!e||f.kind!=='disposable')throw Error('Fixture only');
 const u=(await p.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId])).rows[0].user_id;
 const l=(await p.query("insert into location(organization_id,name,created_by,updated_at) values($1,'Reception',$2,now()) returning id",[a.organizationId,u])).rows[0].id;
 const s=(await p.query("insert into location_subarea(location_id,name,created_by,updated_at) values($1,'Front desk',$2,now()) returning id",[l,u])).rows[0].id;
 const t=(await p.query("insert into shift_template(organization_id,name,start_time,end_time,subarea_id,created_by,updated_at) values($1,'Morning reception','09:00','17:00',$2,$3,now()) returning id",[a.organizationId,s,u])).rows[0].id;
 for(const [date,start,end,status,emp,note] of [['2026-11-16','09:00','17:00','published',e.employeeId,'Published reception'],['2026-11-17','22:00','06:00','draft',null,'Open overnight draft'],['2026-11-18','09:00','17:00','published',null,'Open published shift']])await p.query("insert into shift(organization_id,employee_id,template_id,subarea_id,date,start_time,end_time,status,notes,created_by,updated_at) values($1,$2,$3,$4,$5::date at time zone 'Europe/Berlin',$6,$7,$8,$9,$10,now())",[a.organizationId,emp,t,s,date,start,end,status,note,u]);
}
await p.end();console.log('Seeded three shifts and one template per generated org; no auth/session/membership/grant changes.');

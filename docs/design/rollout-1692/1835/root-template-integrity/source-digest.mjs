import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const [phase]=process.argv.slice(2),source='cda10d3e2e42fee034ab9ad1df2bc4eafda091e8',base='3782c6ad3af0eff2800f39253b9a601edf7def17';assert.ok(['before','after'].includes(phase));
const route='apps/webapp/src/app/[locale]/onboarding/work-templates/',pins=[...['actions.ts','page-client.tsx','page.test.tsx','submission-arrival.test.tsx','atomicity.integration.test.ts'].map(x=>route+x),
 'apps/webapp/src/lib/effect/services/onboarding.service.ts','apps/webapp/src/lib/user-preferences/user-settings-mutation.ts','apps/webapp/src/lib/onboarding/work-template-mutation.ts',
 'apps/webapp/src/db/schema/work-policy.ts','apps/webapp/src/db/schema/user-settings.ts','apps/webapp/src/db/auth-schema.ts',
 'apps/webapp/src/lib/validations/onboarding.ts','apps/webapp/src/lib/organization-action/settings-access.ts','apps/webapp/src/lib/organization-action/settings-access-level.ts',
 'apps/webapp/src/lib/auth/organization-role.ts','apps/webapp/src/lib/employee-lifecycle/current-roster.ts','apps/webapp/src/lib/time-tracking/work-transaction/index.ts'];
const sha=b=>createHash('sha256').update(b).digest('hex'),canon=b=>b.toString('utf8').replaceAll('\r\n','\n'),sourcePins=[];
for(const path of pins){const ref=phase==='before'&&path.endsWith('/onboarding.service.ts')?base:source,expected=execFileSync('git',['show',ref+':'+path]);assert.equal(canon(await readFile(path)),canon(expected),path);sourcePins.push({path,ref,canonicalSha256:sha(canon(expected))});}
const digest=sha(sourcePins.map(p=>p.path+'\0'+p.canonicalSha256).join('\n'));
await writeFile('.tmp/1835-root-checks/declared-runtime-'+phase+'.json',JSON.stringify({phase,sourceCommit:source,beforeService:base,digest,sourcePins,onlyHistoricalServiceOverlay:phase==='before'},null,2)+'\n');
console.log(JSON.stringify({phase,digest,sourceFiles:sourcePins.length}));

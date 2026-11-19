import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
const git = (...args) => execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert.ok(process.env.npm_execpath);
const suites=[
 'src/components/forgot-password-form.test.tsx','src/components/ui/tanstack-form.test.tsx',
 'src/components/auth-form-wrapper.test.tsx','src/components/auth-shell-controls.test.tsx',
 'src/lib/turnstile/auth-plugin.test.ts','src/lib/turnstile/service.test.ts','src/lib/turnstile/verify.test.ts','src/lib/turnstile/development-keys.test.ts',
 'src/lib/domain/platform-domain.test.ts','src/lib/domain/request-domain.test.ts','src/lib/domain/request-origin.test.ts',
 'src/lib/auth-domain-config.test.ts','src/lib/email/auth-emails.test.ts','src/tolgee/extracted-key-defaults.test.ts',
 'src/app/[locale]/(auth)/layout-turnstile.test.tsx','src/app/[locale]/(auth)/layout.test.tsx','src/app/[locale]/(auth)/primary-fallbacks.test.tsx',
 'src/components/auth-form-fallbacks.test.tsx','src/lib/auth/reserved-email-guard.test.ts'
];
const checks=[
 ['tests',['--filter','webapp','exec','vitest','run','--project','unit',...suites]],
 ['types',['--filter','webapp','typecheck']],
 ['biome',['--filter','webapp','exec','biome','check','src/components/forgot-password-form.tsx','src/components/forgot-password-form.test.tsx']],
 ['doctor',['exec','react-doctor','apps/webapp/src/components/forgot-password-form.tsx','--no-telemetry','--verbose']],
 ['diff',['exec','git','diff','--check']]
];
const component='apps/webapp/src/components/forgot-password-form.tsx';
const result={head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),dirty:git('status','--porcelain','--untracked-files=no'),componentSha256:createHash('sha256').update(readFileSync(component)).digest('hex'),checks:[]};
for(const [label,args] of checks){
 const run=spawnSync(process.env.npm_execpath,['--config.verifyDepsBeforeRun=false',...args],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
 const output=(run.stdout??'')+(run.stderr??'');
 result.checks.push({label,command:['pnpm',...args],exitCode:run.status,output});
 writeFileSync('docs/design/rollout-1692/1821/quality.json',JSON.stringify(result,null,2),'utf8');
 console.log(`${label}: exit ${run.status}`);
 assert.equal(run.status,0,`${label} failed; inspect quality.json`);
}

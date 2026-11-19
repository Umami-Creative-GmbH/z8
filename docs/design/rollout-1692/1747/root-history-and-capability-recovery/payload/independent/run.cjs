const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = process.cwd();
const safe = path.join(root, '.tmp/r165-independent-SAFE');
const mode = process.argv[2];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function run(id, command, options={}) {
  const start = new Date().toISOString();
  const out = cp.spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 40e6,
    env: { ...process.env, pnpm_config_verify_deps_before_run: 'false', ...options.env } });
  fs.writeFileSync(path.join(safe, id+'.log'), (out.stdout||'')+(out.stderr||'')+(out.error ? String(out.error):''));
  const file = path.join(safe, 'commands.json');
  const commands = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
  commands.push({id, command, start, end:new Date().toISOString(), exit: out.status, signal:out.signal, ...options.receipt});
  fs.writeFileSync(file, JSON.stringify(commands,null,2)+'\n');
  console.log(JSON.stringify({id, exit:out.status, signal:out.signal, tail:((out.stdout||'')+(out.stderr||'')).slice(-1800)}));
  return out.status;
}
const pnpm = 'pnpm --config.verify-deps-before-run=false';
if (mode === 'priority') {
  const source = path.join(safe, 'priority.test.tsx');
  const dest = path.join(root, 'apps/webapp/src/components/travel-expenses/r165-independent-priority.test.tsx');
  if (fs.existsSync(dest)) {
    const prior = JSON.parse(fs.readFileSync(path.join(safe,'bridge.json')));
    if (sha(fs.readFileSync(dest)) !== prior.sha256) throw Error('Changed bridge');
    const archived=path.join(safe,`bridge-source-${prior.sha256}.tsx`);
    if (!fs.existsSync(archived)) fs.copyFileSync(dest,archived);
  }
  fs.copyFileSync(source,dest);
  fs.writeFileSync(path.join(safe,'bridge.json'), JSON.stringify({source,dest,sha256:sha(fs.readFileSync(source))},null,2));
  const id=process.argv[3] || 'priority-attempt1';
  run(id, `${pnpm} --dir apps/webapp exec vitest run --project unit src/components/travel-expenses/r165-independent-priority.test.tsx --maxWorkers=1 --bail=1 --reporter=json --outputFile ../../.tmp/r165-independent-SAFE/${id}.json`);
} else if (mode === 'unit') {
  const receipt=JSON.parse(fs.readFileSync('docs/design/rollout-1692/1747/root-history-withdrawal-checks.json'));
  run('unit13', `${pnpm} --dir apps/webapp exec vitest run --project unit ${receipt.rootTdd.unitSelection.map(x=>JSON.stringify(x)).join(' ')} --maxWorkers=1 --reporter=json --outputFile ../../.tmp/r165-independent-SAFE/unit13.json`);
} else if (mode === 'pg') {
  const bin=path.join(safe,'bin'); fs.mkdirSync(bin,{recursive:true});
  fs.writeFileSync(path.join(bin,'pnpm'), '#!/bin/sh\nexport pnpm_config_verify_deps_before_run=false\nexec /c/Users/KaiHentschel/AppData/Local/pnpm/bin/pnpm --config.verify-deps-before-run=false "$@"\n');
  const git='C:\\Users\\KaiHentschel\\scoop\\apps\\git\\current';
  const names=['expense-history','report-draft','trip-report-draft','expense-officer-access','export-reimbursement','mileage-policy'];
  const files=names.map(n=>`src/lib/travel-expenses/${n}.integration.test.ts`);
  for (const file of files) if (!fs.existsSync('apps/webapp/'+file)) throw Error('Missing suite '+file);
  run('pg6',`${pnpm} --dir apps/webapp run test:integration ${files.join(' ')} --maxWorkers=1 --reporter=json --outputFile ../../.tmp/r165-independent-SAFE/pg6.json`,{
    env:{PATH:[bin,git+'\\bin',git+'\\usr\\bin',process.env.PATH].join(';')},
    receipt:{nestedPnpm:'SAFE/bin/pnpm prepends --config.verify-deps-before-run=false; inherited pnpm_config_verify_deps_before_run=false',selection:files}
  });
} else if (mode === 'quality') {
  run('typegen',`${pnpm} --dir apps/webapp exec next typegen`);
  for (const [id,config] of [['main-types','tsconfig.typecheck.json'],['workflow-types','tsconfig.workflow-contracts.json'],['smoke-types','tsconfig.smoke.json']])
    run(id,`${pnpm} --dir apps/webapp exec tsc --project ${config} --noEmit --incremental false`);
  const receipt=JSON.parse(fs.readFileSync('docs/design/rollout-1692/1747/root-history-withdrawal-checks.json'));
  const files=receipt.sourcePins.map(p=>p.path.replace('apps/webapp/','')).join(' ');
  run('lint',`${pnpm} --dir apps/webapp exec biome lint --config-path=biome.jsonc ${files}`);
  run('format-ordinary',`${pnpm} --dir apps/webapp exec biome check --config-path=biome.jsonc ${files}`);
  run('format-explicit',`${pnpm} --dir apps/webapp exec biome check --config-path=biome.jsonc --line-width=100 --line-ending=crlf ${files}`);
  run('doctor',`${pnpm} exec react-doctor apps/webapp --scope files --base c70858bfe507eb99f844a455230e312cc8247b61 --include-untracked --no-score --no-supply-chain --no-parallel --max-duration 90 --verbose --json --json-out .tmp/r165-independent-SAFE/doctor.json`,{env:{REACT_DOCTOR_PARALLEL:'1'}});
} else throw Error('Unknown mode');

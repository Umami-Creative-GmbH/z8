from review import *
selection=json.loads((SAFE/'selection.json').read_text())
app=['--dir','apps/webapp','exec']
task=sys.argv[1]
if task=='compatibility':
 files=[p.removeprefix('apps/webapp/') for p in selection['physicalFiles']]
 sys.exit(run(task,app+['vitest','run','--project','unit',*files,'--maxWorkers=1','--bail=1','--reporter=json','--outputFile',str(OUT/'compatibility.json')]))
elif task=='quality':
 files=[p.removeprefix('apps/webapp/') for p in selection['quality']]
 if not (SAFE/'lint.command.json').exists(): run('lint',app+['biome','check','--config-path=biome.jsonc','--formatter-enabled=false',*files])
 if not (SAFE/'explicit100crlf.command.json').exists(): run('explicit100crlf',app+['biome','check','--config-path=biome.jsonc','--line-width=100','--line-ending=crlf',*files])
 owned=['src/components/travel-expenses/legacy-draft-conversion.tsx','src/components/travel-expenses/legacy-draft-conversion-withdrawal.test.tsx']
 run('owned-explicit100crlf',app+['biome','check','--config-path=biome.jsonc','--line-width=100','--line-ending=crlf',*owned])
 run('owned-ordinary',app+['biome','check','--config-path=biome.jsonc',*owned])
 run('workflow-types',app+['tsc','--project','tsconfig.workflow-contracts.json','--noEmit','--incremental','false'])
 run('smoke-types',app+['tsc','--project','tsconfig.smoke.json','--noEmit','--incremental','false'])
elif task=='doctor':
 run('doctor-version',['exec','react-doctor','--version'])
 sys.exit(run('doctor',['exec','react-doctor','apps/webapp','--scope','files','--base','85d6a75b4522e84fc701d0bf98f9dda5a9f8aaf4','--include-untracked','--no-score','--no-supply-chain','--no-parallel','--max-duration','90','--verbose','--json','--json-out',str(OUT/'doctor.json')]))
elif task=='types':
 if not (SAFE/'typegen.command.json').exists(): run('typegen',app+['next','typegen'])
 sys.exit(run('main-types',app+['tsc','--project','tsconfig.typecheck.json','--noEmit','--incremental','false']))
elif task=='integration':
 os.environ['PATH']=str(OUT/'bin')+os.pathsep+'C:/Users/KaiHentschel/scoop/apps/git/current/usr/bin'+os.pathsep+os.environ['PATH']
 files=['src/lib/travel-expenses/'+p+'.integration.test.ts' for p in ['claim-read','legacy-draft-conversion','finance-settlement','expense-officer-access']]
 sys.exit(run('integration',['--dir','apps/webapp','run','test:integration',*files,'--maxWorkers=1','--reporter=json','--outputFile',str(OUT/'integration.json')]))

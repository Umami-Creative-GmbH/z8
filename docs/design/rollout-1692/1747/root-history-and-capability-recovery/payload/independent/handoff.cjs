const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const safe='.tmp/r165-independent-SAFE';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const preservation=read(safe+'/preservation.json'),multi=read(safe+'/case-multiset.json'),doctor=read(safe+'/doctor.json');
const commands=read(safe+'/commands.json');
const packages=['react','react-dom','@tanstack/react-query','vitest','@biomejs/biome'];
const physical=packages.map(p=>{const real=fs.realpathSync('apps/webapp/node_modules/'+p);if(!real.startsWith(process.cwd()+path.sep))throw Error('Dependency escaped checkout');const manifest=path.join(real,'package.json'),st=fs.statSync(manifest);return {package:p,physicalPath:real,manifestBytes:st.size,manifestSha256:sha(fs.readFileSync(manifest)),hardlinks:st.nlink};});
fs.writeFileSync(safe+'/dependency-receipt.json',JSON.stringify({manager:'pnpm@12.16.1',install:'offline frozen ignore-scripts package-import-method=copy',lockSha256:preservation.lock,store:'X:/PackageStores/pnpm/v11',virtualStore:path.join(process.cwd(),'node_modules/.pnpm'),physical,licenseCopiedOrGenerated:false,bootstrapQualification:'First non-escalated --version reported launcher fallback 12.21.0 with engine-lock denial; install attempt refused before dependency work. Authorized retry selected 12.16.1; all installs/test/quality runner executions used that pinned version. No dependency upgrade or postinstall.'},null,2)+'\n');
const extraCommands=[
 {command:"$env:pnpm_config_verify_deps_before_run='false'; pnpm --config.verify-deps-before-run=false --version",exit:null,result:'Separate version-probe exit was not captured; the combined shell ended1 after install refusal. stdout12.21.0 fallback with engine-store warning; not pinned-version proof.',log:'pnpm-version.log'},
 {command:'pnpm --config.verify-deps-before-run=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy',exit:1,result:'non-escalated engine-store lock access denied; no install',log:'install-attempt1.log'},
 {command:"$env:pnpm_config_verify_deps_before_run='false'; pnpm --config.verify-deps-before-run=false --version",exit:0,result:'escalated: 12.16.1',log:'pnpm-version-escalated.log'},
 {command:'pnpm --config.verify-deps-before-run=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy',exit:0,result:'escalated: 1823 physically copied packages, downloaded0, ignore-scripts',log:'install-attempt2.log'},
 {command:'node docs/design/rollout-1692/1748/root-withdrawal-and-continuation/verify.cjs',exit:0,log:'archive-verifier.log'},
 {command:'node .tmp/r165-independent-SAFE/fixture-audit.cjs',exit:1,result:'Own audit harness expected nonexistent typescript package; no product execution',log:'fixture-audit-attempt1.log'},
 {command:'node .tmp/r165-independent-SAFE/fixture-audit.cjs',exit:0,result:'Used installed own @babel/parser; original assertion chains and test names preserved',log:'fixture-audit-final.log'},
 {command:'node .tmp/r165-independent-SAFE/multiset.cjs',exit:0,result:'253 exact distinct identities across20 files;172 overlap frozen #1748'},
 {command:'node .tmp/r165-independent-SAFE/audit.cjs',exit:0,result:'Twice, nonadditive read-only Git and immutable archive preservation'},
 {command:"docker ps --all --filter 'name=^/z8_approval_workflow_repository_test_1794971184289582700_13971$' --format '{{.Names}}'",exit:0,result:'Escalated exact owned container readback empty',log:'docker-release.log'},
 {command:'Get-CimInstance Win32_Process (filtered before output to node/bash/pnpm/cmd commands for this checkout or SAFE runner)',exit:null,result:'Non-escalated inventory denied; attempt1 receipt is INVALID evidence of absence. Escalated ErrorAction Stop retry succeeded with zero matching processes.',receipt:'resource-release.json'},
];
fs.writeFileSync(safe+'/commands-extra.json',JSON.stringify({env:'pnpm_config_verify_deps_before_run=false on every invocation; explicit --config.verify-deps-before-run=false; nested Bash shim prepends it',extraCommands},null,2)+'\n');
const fixture=read(safe+'/fixture-reconciliation.json');
const report={
 schemaVersion:1,issue:1747,scope:'NEW bounded independent R165 withdrawal correction recheck; not 157-ticket whole-branch, runtime, readiness or publication acceptance',
 verifiedCommit:null,source:{head:preservation.head,tree:preservation.tree,appTree:preservation.app,parents:preservation.parents,...preservation.provenance},
 findings:{critical:[],spec:[],standards:[],toolDiagnostics:[{severity:'P3',kind:'ordinary formatting',files:4,exit:1,scope:'Four root-correction TS/TSX files; existing declared style qualification. Explicit100CRLF passes; no fixes.'}],
 lowerConfidenceObjections:[],limitations:[
 'The exact canonical {success:false,error:"Unauthorized"} history response withdraws this consumer evidence. No new authority or server revision semantics were invented.',
 'A fresh successful read may restore rows or healthy empty, including after retired conversion invalidation. No claim that session/authority revocation is linearizable across separate server requests or observers.',
 'The session hook, session atom, context HTTP transport, server actions, navigation, translations and toast edges are adapted. Controllers, query owners, row leaves, real providers, local Retry and HeaderRefreshButton run as production code.',
 'No browser, Next server, native or current runtime acceptance performed. Live retirement/revocation/foreign-data/accessibility/wide-layout limits remain root-owned.',
 'Issue OPEN/KaiSoellch is supplied/inherited; this review performs no tracker operation or fresh live tracker verification.',
 'Historical green-exact contains7 current passes plus1 unchanged failed premerge control; overall not green. No archived application driver executed or proof resealed.'
 ]},
 results:{priority:{passed:20,total:20,file:'priority-final.json',actualHeaderAndRetry:true,
 objections:['durable refusal across structured and rejected outages','all report/legacy/provenance links, money, counts and row controls disappear','ordinary structured/transport outage preserves available evidence','initial refusal stays unknown; fresh empty restores healthy zero counts','no-match cannot hide refusal and recovery preserves selection','held continuation success and private refusal details retired by history refusal','positive active continuation navigates once','held history and continuation across pending/account/org/employee/provider/Activity arrival boundaries']},
 unit:{passed:183,total:183,files:13,file:'unit13.json',selection:'Committed rootTdd.unitSelection, exactly'},
 pg:{passed:50,total:50,files:6,file:'pg6.json',selection:commands.find(c=>c.id==='pg6').selection,runner:'Unmodified standard test:integration -> run-approval-workflow-repository-integration.sh -> run-postgres-integration-suites.sh, verifier + maxWorkers1',migrationVerifier:'custom-schema refusal, incident recovery, retry idempotency, anchor-present index recovery, fresh chain passed',warnings:['Vite native-config future compatibility warning','pg concurrent client.query deprecation warning'],ownedContainerRemoved:true},
 identities:{file:'case-multiset.json',...multi.counts,overlapFrozen1748:{unit:159,pg:13,total:172,notAdded:true}},
 quality:{typegen:0,mainTypes:{exit:1,soleDiagnostic:"src/app/[locale]/(auth)/licenses/page.tsx(7,22): TS2307 missing @/data/licenses.json",licenseAbsent:true,licenseNotCopiedOrGenerated:true},workflowTypes:0,smokeTypes:0,lint4:0,ordinaryFormat4:{exit:1,findings:4},explicit100CrLf4:0,doctor:{version:doctor.version,exit:0,errorCount:doctor.summary.errorCount,warningCount:doctor.summary.warningCount,files:doctor.projects[0].analyzedFiles}},
 fixtureReconciliation:{file:'fixture-reconciliation.json',assertionsRemoved:fixture.results.flatMap(x=>x.removed).length,testNamesUnchanged:true,baselineAssertions:72,currentAssertions:73,additionalExpectation:'wait until public Continue as report is enabled'},
 },
 preservation:{file:'preservation.json',archiveVerifier:'archive-verifier.log',archiveFiles:202,currentSourcePins:{unchanged:12,total:14,expectedDifferences:preservation.sourceEvolution},anchors:65,statuses:preservation.statuses,nodes:157,edges:159,templates:172,aliases:19,rootNonoverlap:preservation.rootPreservation,incomingNonoverlap:preservation.incomingPreservation,
 qualification:'Counts18780 and82 exclude paths allowed to change in root correction/metadata as well as opposite-parent changes; different selection from historical18783/85. All examined nonoverlap bytes match. No broader inherited evidence acceptance claim.'},
 attempts:{priorityAttempt1:{exit:1,passed:0,failed:1,unrun:12,classification:'Harness wrong accessible filter name All 2 versus actual All2; no refusal exercised before bail; source retained'},priorityAttempt2:{exit:0,passed:13,notAdded:true},priorityFinal:{exit:0,passed:20},fixtureAudit:'First missing-parser harness failed, corrected using own installed Babel parser; no production failure',resourceInventory:'First denied inventory invalidated; successful escalated retry proves zero matching owned processes'},
 cleanup:{bridge:'bridge-removal.json',hashGuarded:true,removedOnlyOwnUnchangedBridge:true,release:'resource-release.json',ownedLiveResources:0,physicalDependenciesPreserved:true,privateEvidencePreserved:true,sourceClean:true,indexClean:true,indexLockAbsent:true},
 commands:'commands.json and commands-extra.json contain literal commands/exits; shell wrapper aggregate exit0 does not change individual child exits',
 remaining:'Root retains all source fixes, integration, publication and readiness. No readiness or verifiedCommit update, tracker write, commit, push, PR, closure, dev merge, deployment, browser runtime or delegate.'
};
fs.writeFileSync(safe+'/handoff.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({findings:report.findings.critical.length,source:report.source.head,distinct:multi.counts.distinct,licenseQualified:true,ownedResources:0}));

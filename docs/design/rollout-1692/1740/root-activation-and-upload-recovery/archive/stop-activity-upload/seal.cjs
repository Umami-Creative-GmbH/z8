const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const cp=require('node:child_process');
const base=__dirname;const root=path.resolve(base,'../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function readLog(name){const b=fs.readFileSync(path.join(base,name));return (b[0]===255&&b[1]===254?b.toString('utf16le'):b.toString('utf8')).replace(/^\uFEFF/,'').replace(/\x1b\[[0-9;]*m/g,'')}
for(const [input,output] of [['public-03.log','public-results.txt'],['final-candidate-upload.log','candidate-result.txt'],['premerge-upload-control.log','premerge-result.txt']]){
 const lines=readLog(input).split(/\r?\n/).filter(l=>/safe upload|Test Files|^\s+Tests\s|[✓×].*1740-activation-independent-bridge/.test(l));
 fs.writeFileSync(path.join(base,output),lines.join('\n')+'\n');
}
const current=fs.readFileSync(path.join(base,'public-acceptance.test.tsx'),'utf8');
const addedStart=current.indexOf("\nit('an interrupted real staged upload");
const addedEnd=current.indexOf("\nit('assembled current workspace",addedStart);
if(addedStart<0||addedEnd<0)throw Error('Missing known sole addition');
// Undo only the known added test, leaving the original blank separator.
fs.writeFileSync(path.join(base,'public-passing-13.test.tsx'),current.slice(0,addedStart)+current.slice(addedEnd));
const audit=JSON.parse(fs.readFileSync(path.join(base,'candidate-audit.json'),'utf8'));
const results={status:'STOP_CURRENT_ACCEPTANCE_BLOCKED',verifiedCommit:null,issues:'OPEN; no tracker mutations',candidate:audit.candidate,fix:audit.fix,premerge:audit.premergeControl.commit,classification:'Inherited failed upload recovery; premerge disabled after return, current enabled retry errors and starts no upload',fresh:{surroundingPublic:{passed:13,failed:0,physicalBridgePaths:1,run:'public-03.log'},minimalCurrentUpload:{passed:1,failed:1,physicalBridgePaths:1,run:'final-candidate-upload.log'},premergeSameContract:{passed:1,failed:1,physicalBridgePaths:1,run:'premerge-upload-control.log',overlap:'same two behavioral identities; not additive'},pg:0,nextRuntime:false,browser:false,typegen:false,threeTypes:false,lint:false,doctor:false},candidateObservation:{uploadRequestsTotal:1,newUploadRequests:0,recordingCommandCalls:0,errorNotifications:1,submitEnabledOnReturn:true,notesRetained:true,fileRetained:true},premergeObservation:{uploadRequestsTotal:1,newUploadRequests:0,recordingCommandCalls:0,errorNotifications:0,submitEnabledOnReturn:false,notesRetained:true,fileRetained:true},transportControl:'same actual File/Uppy/TUS browser build completes POST/PATCH and dispatches exactly one synthetic refusal command on both commits',noServerWrites:true,noAuthStateArtifacts:true,cleanup:audit.resources};
fs.writeFileSync(path.join(base,'results.json'),JSON.stringify(results,null,2)+'\n');
const names=['HANDOFF.md','audit.cjs','bridge.cjs','browser-upload.config.mts','minimize.cjs','seal.cjs','upload-cases.fragment','upload-recovery.test.tsx','public-acceptance.test.tsx','public-passing-13.test.tsx','public-results.txt','candidate-result.txt','premerge-result.txt','results.json','candidate-audit.json','resource-seal.json'];
const allowlist={root:base,scope:'SAFE synthetic/local handoff only; raw failures/auth/profile/controller/action/RSC bodies/images excluded',files:names.map(name=>{const b=fs.readFileSync(path.join(base,name));return {path:name,bytes:b.length,sha256:sha(b)}})};
const listBytes=Buffer.from(JSON.stringify(allowlist,null,2)+'\n');fs.writeFileSync(path.join(base,'safe-allowlist.json'),listBytes);
fs.writeFileSync(path.join(base,'SHA256SUMS.txt'),sha(listBytes)+'  safe-allowlist.json\n');
for(const entry of allowlist.files){if(sha(fs.readFileSync(path.join(base,entry.path)))!==entry.sha256)throw Error('Hash mismatch '+entry.path)}
const status=cp.execFileSync('git',['status','--porcelain=v1'],{cwd:root,encoding:'utf8'}).trim();if(status)throw Error('Final checkout not clean');
console.log(JSON.stringify({candidate:audit.candidate,status:'STOP',safeFiles:names.length,allowlistSha256:sha(listBytes),clean:true,liveOwnResources:0,verifiedCommit:null}));

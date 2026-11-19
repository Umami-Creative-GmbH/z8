const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'public-acceptance.test.tsx'),'utf8');
let header=source.slice(0,source.indexOf('const deferred='));
header=header.split('\n').filter(l=>!l.startsWith('import {TeamAbsencesWorkspace}')&&!l.startsWith('const row=')&&!l.startsWith('const props=')).join('\n');
header=header.replace('recordAbsenceWithSickNotes:vi.fn()','recordAbsenceWithSickNotes:transport.record');
const helpers=source.slice(source.indexOf('afterEach(()=>'),source.indexOf("it('an interrupted real staged upload"));
const tests=fs.readFileSync(path.join(__dirname,'upload-cases.fragment'),'utf8');
fs.writeFileSync(path.join(__dirname,'upload-recovery.test.tsx'),header+'\n'+helpers+'\n'+tests);

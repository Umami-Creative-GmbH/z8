import { execFileSync } from 'node:child_process';
export const binary='C:/Users/KaiHentschel/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser-win32-x64.exe';
export const commands=[];
export function cli(...args){
 commands.push(args);
 return execFileSync(binary,['--namespace','z8-1739','--session','z8-1739-final',...args],{encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024,stdio:['pipe','pipe','pipe']});
}
export function evaluate(source){
 commands.push(['eval','--stdin','<reviewed script>']);
 const response=JSON.parse(execFileSync(binary,['--namespace','z8-1739','--session','z8-1739-final','--json','eval','--stdin'],{input:source,encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024,stdio:['pipe','pipe','pipe']}));
 if(!response.success) throw Error(JSON.stringify(response));
 return response.data.result;
}

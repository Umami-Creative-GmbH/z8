import{readFileSync,writeFileSync}from'node:fs';
let s=readFileSync('.tmp/1733-command-checks/runtime/public/harness/native.mjs','utf8').replaceAll('.tmp/1733-command-checks/runtime','.tmp/1733-final-runtime-checks/runtime').replaceAll('<private-fixture-pointer-file>','.tmp/1733-final-runtime-checks/runtime/runtime-pointer-private.txt').replaceAll('z8-1733-v2-','z8-1733-final-').replaceAll('<installed-native-cli>','<user-home>/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser.js');
s=s.replace("journey.currentMatched.source","journey.initial.source");
s=s.replace("source:journey.initial.source,attempts:[]","source:journey.initial.source,attempts:[],session");
writeFileSync('.tmp/1733-final-runtime-checks/runtime/native.mjs',s);console.log('Fresh transient native harness prepared.');

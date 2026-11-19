import { readFileSync, writeFileSync } from 'node:fs';
const folder='.tmp/1739-checks';
writeFileSync(`${folder}/native-final.mjs`,readFileSync(`${folder}/native.mjs`,'utf8').replaceAll('z8-1739-transient','z8-1739-final'));
writeFileSync(`${folder}/login-final.mjs`,readFileSync(`${folder}/login.mjs`,'utf8').replaceAll('z8-1739-transient','z8-1739-final'));
let driver=readFileSync(`${folder}/runtime.mjs`,'utf8').replace("'./native.mjs'","'./native-final.mjs'");
driver=driver.replace("const out=",`const {directory}=JSON.parse(readFileSync(new URL('./private-pointer.json',import.meta.url)));\nconst {origin}=JSON.parse(readFileSync(directory+'/runtime-private.json'));\nconst out=`).replaceAll("'http://localhost:55845/en/team'","origin+'/en/team'");
driver=driver.replace("const observations={head,source:pins(),",`const observations={head,origin,driverSha256:hash(readFileSync(new URL('./runtime-final.mjs',import.meta.url))),source:pins(),`);
writeFileSync(`${folder}/runtime-final.mjs`,driver);

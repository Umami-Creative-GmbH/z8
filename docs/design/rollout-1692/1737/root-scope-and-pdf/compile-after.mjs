import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(resolve('apps/webapp/package.json')),babel=require('next/dist/compiled/babel/core'),compiler=require('babel-plugin-react-compiler');
const filename=resolve('apps/webapp/src/components/reports/vehicles/vehicle-report-exports.tsx'),events=[];
const result=babel.transformSync(readFileSync(filename,'utf8'),{filename,configFile:false,babelrc:false,parserOpts:{plugins:['typescript','jsx']},plugins:[[compiler,{target:'19',logger:{logEvent(file,event){events.push({file,event});}}}]]});
writeFileSync('.tmp/1737-root-checks/compiler-after.mjs',result.code);
writeFileSync('.tmp/1737-root-checks/compiler-after.json',JSON.stringify({filename,compiled:true,events},null,2)+'\n');
console.log(JSON.stringify({compiled:true,events}));

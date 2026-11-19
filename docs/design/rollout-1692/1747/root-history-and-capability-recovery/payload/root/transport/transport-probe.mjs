import fs from 'node:fs';
const result={endpoint:'https://challenges.cloudflare.com/turnstile/v0/siteverify',method:'HEAD',credentials:false,token:false,configurationChanged:false};
try {const response=await fetch(result.endpoint,{method:'HEAD',signal:AbortSignal.timeout(10000)});Object.assign(result,{transportReached:true,status:response.status});} catch(error){Object.assign(result,{transportReached:false,name:error?.name,message:error?.message,causeCode:error?.cause?.code??null});}
fs.writeFileSync(new URL('./transport-probe-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));if(!result.transportReached)process.exitCode=1;

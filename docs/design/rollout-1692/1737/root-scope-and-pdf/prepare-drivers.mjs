import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const dir='.tmp/1737-root-checks/drivers/';
for(const [file,old,replacement] of [
 ['common.mjs',"const directory=resolve((await readFile(resolve(pointer),'utf8')).trim()),rel=relative(join(repo,'.tmp'),directory);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Only an own root-checkout .tmp fixture');","const directory=await readOwnedFixtureDirectory(repo,pointer);"],
 ['seed.mjs',"const directory=resolve((await readFile(pointer,'utf8')).trim()),rel=relative(join(root,'.tmp'),directory);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel));","const directory=await readOwnedFixtureDirectory(root,pointer);"]
]){let text=await readFile(dir+file,'utf8');assert.ok(text.includes(old),file);text="import {readOwnedFixtureDirectory} from './owned-fixture-path.mjs';\n"+text.replace(old,replacement);if(file==='seed.mjs'){text=text.replace("import {readFile} from 'node:fs/promises';","import {readFile,writeFile} from 'node:fs/promises';").replace("}catch(error){console.error(","}catch(error){await writeFile(join(directory,'root-seed-error-private.json'),JSON.stringify({name:error.name,message:error.message,detail:error.detail,stack:error.stack}),{mode:0o600});console.error(");}await writeFile(dir+file,text);}
let runner=await readFile(dir+'run-seed.mjs','utf8');runner=runner.replace('|NODE_OPTIONS','');await writeFile(dir+'run-seed.mjs',runner);console.log('Own private Temp nonce fixture allowed; exact pointer, loopback marker and labels remain required.');

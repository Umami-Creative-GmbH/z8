import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,sep} from 'node:path';
const repo=process.cwd(),require=createRequire(join(repo,'apps/webapp/package.json'));
const result={dirs:[],packages:[],lockSha256:createHash('sha256').update(await readFile('pnpm-lock.yaml')).digest('hex').toUpperCase()};
for(const path of ['node_modules','apps/webapp/node_modules','node_modules/.pnpm']){const stat=await lstat(path);assert(stat.isDirectory()&&!stat.isSymbolicLink());result.dirs.push({path,physical:true});}
for(const name of ['next','react','react-dom','vitest','babel-plugin-react-compiler']){const path=require.resolve(name);assert(path.toLowerCase().startsWith(repo.toLowerCase()+sep));result.packages.push({name,path,local:true});}
assert.equal(result.lockSha256,'2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799');
await writeFile('docs/design/rollout-1692/1730/dependencies.json',JSON.stringify(result,null,2)+'\n');console.log('Physical own dependencies and five package resolutions verified.');

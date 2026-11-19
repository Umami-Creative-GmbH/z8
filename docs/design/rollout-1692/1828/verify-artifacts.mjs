import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join,resolve,relative} from 'node:path';
const root=resolve(process.argv[2]),out=join(root,'docs/design/rollout-1692/1828');
const pngjs=(await readdir(join(root,'node_modules/.pnpm'))).find(n=>n.startsWith('pngjs@'));
if(!pngjs)throw Error('Use installed pngjs for full decode; do not silently substitute header-only validation.');
const require=createRequire(join(root,'package.json')),{PNG}=require(join(root,'node_modules/.pnpm',pngjs,'node_modules/pngjs'));
const images=[],json=[];
async function scan(dir){for(const name of await readdir(dir)){const path=join(dir,name);if((await stat(path)).isDirectory()){await scan(path);continue;}const file=relative(out,path).replaceAll('\\','/');
 if(name.endsWith('.png')){const bytes=await readFile(path),decoded=PNG.sync.read(bytes);images.push({file,width:decoded.width,height:decoded.height,fullyDecoded:true,sha256:createHash('sha256').update(bytes).digest('hex')});}
 if(name.endsWith('.json')){const text=await readFile(path,'utf8'),bom=text.charCodeAt(0)===65279;JSON.parse(bom?text.slice(1):text);json.push({file,hasUtf8Bom:bom});}
}}
await scan(out);await writeFile(join(out,'artifact-verification.json'),JSON.stringify({pngCount:images.length,images,validJsonFiles:json},null,2)+'\n');
console.log(`Fully decoded ${images.length} PNGs and parsed ${json.length} JSON files (BOM presence recorded, original bytes retained).`);

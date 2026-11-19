import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname,basename,sep} from 'node:path';
import {tmpdir} from 'node:os';
export async function readOwnedFixtureDirectory(repo,pointer){
 const ownPointer=resolve(pointer),relativePointer=relative(join(repo,'.tmp'),ownPointer);
 assert.ok(relativePointer&&!relativePointer.startsWith('..')&&!isAbsolute(relativePointer));
 assert.equal(basename(ownPointer),'1835-root-fixture-pointer.txt');
 const directory=resolve((await readFile(ownPointer,'utf8')).trim()),relativeDirectory=relative(join(repo,'.tmp'),directory);
 const insideWorkspace=relativeDirectory&&!relativeDirectory.startsWith('..')&&!isAbsolute(relativeDirectory);
 const canonicalTemp=await realpath(tmpdir()),canonicalDirectory=await realpath(directory),canonicalParent=await realpath(dirname(directory));
 const ownPrivateTemp=canonicalParent.toLowerCase()===canonicalTemp.toLowerCase()&&/^z8-1835-root-[a-f0-9]{32}$/.test(basename(directory))&&canonicalDirectory.toLowerCase().startsWith((canonicalTemp+sep).toLowerCase());
 assert.ok(insideWorkspace||ownPrivateTemp,'Only the exact root-owned workspace or nonce-named private Temp fixture');
 return directory;
}

// One-use loopback cookie handoff to the owned Preview tab. No credentials logged.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {dir,pool,runtime} from './fixture.mjs';
await pool.end();
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const cookies=auth['small-employee'].cookies;
const server=createServer((req,res)=>{
 if(req.url!=='/handoff'){res.writeHead(404).end();return;}
 res.writeHead(302,{'Set-Cookie':cookies.map(c=>`${c.name}=${c.value}; Path=${c.path}; ${c.httpOnly?'HttpOnly; ':''}${c.secure?'Secure; ':''}SameSite=${c.sameSite??'Lax'}`),Location:runtime.origin+'/en/my-documents'}).end();
 server.close();
});
server.listen(0,'localhost',()=>console.log('Owned one-use bridge: http://localhost:'+server.address().port+'/handoff'));

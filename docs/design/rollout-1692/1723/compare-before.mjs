import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const base='40492f6233feecfac214813f28e2f1f26b3175b2';
const files=['apps/webapp/src/components/notifications/notifications-inbox.tsx','apps/webapp/src/components/notifications/notification-item.tsx','apps/webapp/src/hooks/use-notifications.ts','apps/webapp/src/lib/navigation/route-metadata.ts'];
const originals=new Map(await Promise.all(files.map(async file=>[file,await readFile(file)])));
try {
 for(const file of files) await writeFile(file,execFileSync('git',['show',`${base}:${file}`]));
 execFileSync(process.env.npm_execpath,['node','docs/design/rollout-1692/1723/capture.mjs',process.argv[2],'before-large'],{stdio:'inherit'});
} finally {for(const [file,bytes] of originals) await writeFile(file,bytes);}

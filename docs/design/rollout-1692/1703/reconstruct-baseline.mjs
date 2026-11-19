// Reconstruct ONLY this implementer's four production files at the required base,
// with byte-for-byte restoration in finally. Does not checkout/reset/stash a tree.
// pnpm node docs/design/rollout-1692/1703/reconstruct-baseline.mjs <private-fixture-directory>
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const paths = ['apps/webapp/src/app/[locale]/(app)/analytics/layout.tsx','apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx','apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/state.ts','apps/webapp/src/lib/navigation/route-metadata.ts'];
const original = await Promise.all(paths.map(p => readFile(p)));
try {
 for (const p of paths) await writeFile(p,execFileSync('git',['show',`551b94f0d22e755217929ac4aa4b56cba5650056:${p}`]));
 execFileSync(process.execPath,['docs/design/rollout-1692/1703/runtime.mjs',process.argv[2],'before'],{stdio:'inherit'});
} finally { for (let i=0;i<paths.length;i++) await writeFile(paths[i],original[i]); }

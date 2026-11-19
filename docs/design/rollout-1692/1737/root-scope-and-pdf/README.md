# #1737 scope and PDF evidence

Run the read-only verifier from the repository root. The optional flag also checks current source and dependency links:

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false node docs/design/rollout-1692/1737/root-scope-and-pdf/verify-evidence.mjs
```

The verifier uses retained public artifacts, read-only Git queries, installed Sharp/PDF.js and syntax checks for retained scripts. It does not execute those scripts, rebuild, install packages, launch browsers/services, read fixture pointers or credentials, or write files. Console JSON is its result. The draft initially requested undeclared `pngjs`; root switched to the already installed Sharp decoder without installing or changing dependencies. Retained React Compiler output keeps TypeScript syntax despite its archive `.mjs` extension, so it is parsed with Next's installed Babel TypeScript/JSX parser. Executable helpers receive ordinary JavaScript syntax checks; the raw compiler output is preserved.

Default mode checks canonical LF pins at source `2fceadad70ac1ebe8459c497de5f2496bce9ee82`, preservation from provisional merge `6d20638f06a1ebf84fd4db8c0c35a66c11da4089`, and all 49 prior verified ancestors. Physical path/fullName/occurrence totals are 61 unit files/587 cases plus 5 public files/20 cases, for 66/607; focused runs corroborate without inflating them. It checks red/green scope evidence, full typecheck and strict lint command pins, actual compiler events 5/1/0 with final CompileSuccess, and Doctor 0 errors/6 warnings.

Runtime covers before 5 checks/4 PNGs, after 5 checks/6 PNGs, native 2 checks with generated owner tree and closed browser, and PDF 2 checks/3 PNGs. Every retained JSON is parsed, every PNG fully decoded, and scripts syntax-checked without execution. The completed PDF is independently checked for signature, 3,554 bytes, SHA256, identity/period/generation text, all twelve months, January 101/February 46, ten zero months, total 147, archived van 118 and own vehicle 29. Accessible inherited CSV/XLSX bytes are hash-compared to incoming and merge blobs; archived parsed rows are checked. Those completion events remain inherited. There is no fresh standalone PostgreSQL suite; 1 file/6 cases remain inherited.

`--current-source` additionally compares the nine checked source files using canonical LF text and checks the sanitized public dependency proof against all 158 current internal links, six exact raw config byte hashes and three physical dependency roots. Those exact pins include shared heading metadata: a later legitimate route opt-in can fail this optional snapshot comparison without invalidating the archived default verification. Default mode validates the inventory and committed config preservation without claiming current targets. Package contents are not certified. Cleanup checks the retained verified Next tree/port 64135, browsers and three owned services; it does not take a fresh live resource inventory.

The generated phone PDF image is operational evidence scrolled past the heading, not a matched top-of-page composition claim. Its raw measurement remains as recorded. Scope comparison phone images retain the heading. Clean Next compile/config/session observations cover only the exact vehicle sessions; earlier global transition and settings auth/Suspense findings remain. Notification-denied/unavailable fixture policy does not establish production permission grants. Controlled before overlays only the historical vehicle container on current support code. Production, remote Tolgee/all locales, provider/device/true zoom, offline/exhaustive accessibility and global transition acceptance remain unpassed. Issues stay open; no dev merge or deployment is asserted.

An assertion failure identifies an evidence mismatch; it does not authorize rewriting raw archives or widening claims. No broader historical report-link audit is performed.

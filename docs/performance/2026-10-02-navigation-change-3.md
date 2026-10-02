# Reports Excel loading — change 3

Excel export loads the existing exporter and filename function on demand. The private module loader is awaited only in the Excel branch, after loading state is set, within the existing asynchronous failure handler. CSV/PDF branches, generated timestamps, filenames, MIME types, workbook implementation, and download cleanup retain their existing behavior. There is no warming or public loader API.

The initial direct import expression inside the component triggered React Doctor's `react-hooks-js/todo` diagnostic because React Compiler cannot lower import expressions there. The controller approved moving that expression into a private module function. The final changed-file scan found no issues; the numerical score API was unreachable.

## Controlled production build evidence

Both builds used the same independent branch, dependencies, configuration, and `apps/webapp` command: `$env:CI='true'; pnpm build`. The base was `0325fc3af08da20c1d7572b9ae029b6ce0f048ff`, built before source edits. The final build includes only this change. Both passed.

| Reports client-reference manifest dependency set | Base | Final | Difference |
| --- | ---: | ---: | ---: |
| Unique JavaScript chunk references | 44 | 44 | 0 |
| Uncompressed JavaScript bytes | 3,666,664 | 2,731,324 | −935,340 |
| Initial chunk containing ExcelJS and report workbook implementation | Present | Absent | Deferred |

The base initial chunk `static/chunks/0fz2mozqo_9n6.js` was 977,336 bytes and contained the ExcelJS and report workbook implementation. In the final build, both are in `static/chunks/16cikvre7wngq.js` (935,686 bytes), which is absent from Reports' initial client-reference chunk set. These sizes include other bundled code and are not isolated ExcelJS package sizes.

The final initial handler chunk `static/chunks/0pf0ztbw0337m.js` contains `await e.A(898632)` only in the `"excel"` branch. The initial loader chunk `static/chunks/0htr9rmzld5g1.js` maps module `898632` to loading `static/chunks/16cikvre7wngq.js`, then resolves module `480761`. This built loader edge verifies the dynamic boundary beyond source-level unit mocks.

The measurements are manifest dependency bytes, not browser-loaded or transferred bytes. The older `c6079f91b` predecessor snapshot used different server-auth code; the table uses the fresh controlled original-base build instead. No browser navigation latency or compressed transfer savings are claimed.

Other ExcelJS consumers remain in the server analytics export route (`/api/analytics/export`, through `src/lib/reporting/excel-export.ts`) and `ReportingService` (which already imports ExcelJS on demand). They were unchanged. This does not remove ExcelJS from the application or establish browser request behavior on every route.

## Behavior verification and pending gates

Eight focused tests pass. They cover mounting without Excel evaluation; CSV/PDF content forwarding, filenames, MIME, and cleanup; Excel module evaluation on click; disabled controls during module loading and generation; separate import and generation failures with successful retries; distinct download URLs and repeated cleanup; and the real fictional workbook's four sheets, monthly work, absence totals, home office dates/hours, compliance values, filename, and pinned generation time.

The import test rejects a mocked module factory, then restores module availability without remounting. Vitest wraps that failure, so the test also checks its cause and the existing toast's forwarded error message. This is separate from generation rejection and does not prove browser chunk-loader retry.

Final typecheck, scoped Biome, direct app production build, and changed-file React Doctor checks pass. The final full unit run is red: 12,612 passed, 137 failed, and 33 pending. Exact comparison to the original base reproduces all 135 base failure names and adds two 5-second timeouts in unchanged chart geometry and approval ownership analyzer tests. Both exact timeout cases pass in an immediate focused rerun. This does not make the full suite green; the complete failure-name inventory and results remain in the task's `unit-comparison.json` and `head-unit-results.json` artifacts.

The following runtime gates remain pending because the disposable authenticated Reports fixture and agent-browser configuration are unavailable: initial navigation and CSV/PDF network request capture, first-click deferred-chunk request and valid fixture download, measured browser-loaded bytes, and failed network chunk request followed by restored-network retry. Phase credentials and production exports were not used. The three required Vercel review skills are unavailable in this checkout; scoped Biome, typecheck, focused tests, production build inspection, and installed React Doctor provide the available checks.

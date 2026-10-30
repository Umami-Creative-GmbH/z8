/** Original-only source and request-value authority. No payload is serialized. */
import { createHash, randomBytes } from "node:crypto";
import { types as utilTypes } from "node:util";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { readInertDateRangeRequestValue, forgetInertDateRangeRequestValue } from "./inert-date-range-request.mjs";
import { validateProxyHeaderCensus, validateProxyHeaderPrefix, validateProxyHeaderLifecycle } from "./proxy-header-census.mjs";

const sha = value => createHash("sha256").update(mixedOwnedHashInput(value)).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const rangeFields = Object.freeze(["start", "end", "startDate", "endDate", "timezone"]);
export const teamReplayHeader = "x-z8-fixture-replay-id";
// Exact shared identity fields; the registered test checks parity with controlIdentityHeaders.
const teamHeaderFields = Object.freeze(["rsc","next-router-prefetch","next-router-segment-prefetch","next-router-state-tree","next-url","next-action","accept","accept-encoding","accept-language","cookie","authorization","x-z8-fixture-document-generation",teamReplayHeader]);
/** Initial is preserved; only positively absent browser-added fields can differ from actual wire headers. */
export function knownOriginalTeamHeaderJoin(initial,extra,wire,cookieHeaderSha256) {
 try {
  const known=row=>row?.requestHeaderSnapshotKnown===true && digest(row.requestHeadersSha256) && ownData(row.headerFieldSha256,teamHeaderFields) && teamHeaderFields.every(key=>row.headerFieldSha256[key]===null || digest(row.headerFieldSha256[key]));
  return digest(cookieHeaderSha256) && [initial,extra,wire].every(known) && extra.requestHeadersSha256===wire.requestHeadersSha256 &&
   wire.headerFieldSha256.cookie===cookieHeaderSha256 && teamHeaderFields.every(key=>extra.headerFieldSha256[key]===wire.headerFieldSha256[key] &&
    (initial.headerFieldSha256[key]===extra.headerFieldSha256[key] || ["cookie","accept-encoding"].includes(key) && initial.headerFieldSha256[key]===null && digest(extra.headerFieldSha256[key])));
 }catch{return false;}
}
export const temporaryValueObservation = Object.freeze({ protocol: "original-team-temporary-value-observation-v1", replayHeader: teamReplayHeader, documentJournal: "actual-cdp-document-journal-v1",annualTeam:Object.freeze({protocol:"team-annual-golden-observation-v1",bodySource:"owned-proxy-natural-eof",selection:"actual-response-object",projection:"team-employees-hours-v1",deadline:"existing-annual-selection",proxyInspection:"source-qualified-event-bound-single-proxy-inspection-v1"}) });
const deepFreeze = value => {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
};
// New original builds require an explicit additional reviewed profile, never a descendant override.
export const originalTeamTemporaryProfiles = deepFreeze([
  {
    "id": "original-team-bfdf-v1",
    "binarySource": "bfdf2d573052eb485d2a6b9bd75896f98882baeb",
    "manifestSha256": "8cd0fc10a5288431c5b7afbc4f3d36273f965d6ff4d5b4a54bebe33a21201e64",
    "buildRecordSha256": "34acb938396ed571886c66933415dd7cede4dda6aaf4ccb82a5048ddf68be147",
    "registrySha256": "301a1afee35124ef83695e842e4d1fe2402d06da38964e0f0def9c4c66741f30",
    "actionHeaderSha256": "355ec2d858094c87d7c3ef4b72d291185893ee976b865ce2916bd10922204884",
    "appFiles": [
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/page.tsx",
        "gitBlob": "b081db8a3018bdcb34932d8eab0d7b9f380c02b8",
        "canonicalLfSha256": "54253fff67a4e10b1b9eb4b43e11ddfdd746de51224e4fa472b7b88d3d759793"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/team-performance/page.tsx",
        "gitBlob": "f7458cf92f0ef2db6304439088ea9173dcb61985",
        "canonicalLfSha256": "69edc9b5a312b33906d6d606f947fb0d03647db64359ac0e42a4acb79b0bed91"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/actions.ts",
        "gitBlob": "9f281b436e86d9555f4562990d87b98ad7519407",
        "canonicalLfSha256": "ca8984fd0f173866eed151ecd037d1b36ee7ed869cd328bcea8689f976099472"
      },
      {
        "path": "apps/webapp/src/lib/effect/services/analytics.service.ts",
        "gitBlob": "aa5bb31705ecb9ac423f729fcc79b57efa045573",
        "canonicalLfSha256": "a2b868807eb10691dcd4b7f90583ed7076ed5e2312e3cdac8fea6df11bd8ef38"
      },
      {
        "path": "apps/webapp/src/lib/effect/result.ts",
        "gitBlob": "5c8cc57d829d33f0019ddb76820632c0dcde6e28",
        "canonicalLfSha256": "ac91c4720ac557fae05a5555df97b65a92af8b25c9750a0f5f4617ce6cb6f57a"
      },
      {
        "path": "apps/webapp/src/lib/analytics/date-ranges.ts",
        "gitBlob": "930365fe7bd9ce19530dfe1b702a048dfd0fca7c",
        "canonicalLfSha256": "095a81ae8f4e87f2f640baa489d487d6dff6465613444d192dffdfe2c2190c1f"
      },
      {
        "path": "apps/webapp/src/lib/analytics/types.ts",
        "gitBlob": "67644543cb2527464c9a4d788917c7286e5a9ef2",
        "canonicalLfSha256": "dad4e4d3c3d23d22f23132ff9b6b8abd4456df8d52310ba0f6d89e795ab9a34d"
      },
      {
        "path": "apps/webapp/src/components/analytics/date-range-picker.tsx",
        "gitBlob": "423d198408a8f68fb8fc771f862b18824be9d8d3",
        "canonicalLfSha256": "9863f2737fef10ce71ee6b0f4bfcbe5b4677ed1fbc244fee95433e83b0d70bf0"
      },
      {
        "path": "apps/webapp/src/components/reports/date-range-picker.tsx",
        "gitBlob": "18c2db57eb55af1e990fda2a8c84afa2c0645317",
        "canonicalLfSha256": "a344338209c40c0bade3fb8b55314c36815ccf547278b2bab584c0ee528d7d7b"
      },
      {
        "path": "apps/webapp/src/lib/reports/date-ranges.ts",
        "gitBlob": "14c82432031f4a1bc2cf98b89151e959433501ba",
        "canonicalLfSha256": "0ab5c18bfa3e6a9c221875c90c5481c96108579c33f552a741a5a624e06f00a4"
      },
      {
        "path": "apps/webapp/src/lib/reports/report-date-range.ts",
        "gitBlob": "7be5b52e66e4e7b2969e49c01d776baf5ea4ab8e",
        "canonicalLfSha256": "a35fa98350fb716ef89d9b726af28bf4e330cd29cff8e222dbe11eb7e999187e"
      },
      {
        "path": "apps/webapp/src/lib/reports/types.ts",
        "gitBlob": "535752e061571025d8121116627bb539f66eb2db",
        "canonicalLfSha256": "2d5c79753dab7987ff92ba70cbb09f557998bc25c80574d03cb188ad49e9f651"
      },
      {
        "path": "apps/webapp/src/lib/datetime/temporal-core.ts",
        "gitBlob": "965c40a9034a3643e185bcaf5d631d530186dd25",
        "canonicalLfSha256": "340864dae1f59706b4d3eb59227e0f83136b3f8bb22a8bb84f15b3ef38608226"
      },
      {
        "path": "apps/webapp/src/lib/timezone/validation.ts",
        "gitBlob": "cc66071cd8d223cb7feea53edb1288636f5847b3",
        "canonicalLfSha256": "630dd41244f4bcf5c2833d9cc7a2c1dec0811c2bc5ebbbbe1b02d26c28b54b7d"
      }
    ],
    "frameworkFiles": [
      {
        "path": "next/package.json",
        "bytes": 3188,
        "sha256": "440efba874450dc997b2c3bf9efa4c3c4835abbc40d65442e94a7c69f4bad031"
      },
      {
        "path": "next/dist/client/app-call-server.js",
        "bytes": 1538,
        "sha256": "f0e9fc00ebb81a3b264c9a4e34b4e6d984dae3055cbea15e2e10f7e3f55997fe"
      },
      {
        "path": "next/dist/client/sequential-call-server.js",
        "bytes": 1859,
        "sha256": "fb04a49cedc4706c7449c7087255b2027fc7893e79d70c709e14d67e516e95e2"
      },
      {
        "path": "next/dist/client/components/use-action-queue.js",
        "bytes": 5940,
        "sha256": "b0495a960d3312966950b78399676dedece7c646ba84fa2543142a3744e1e2ba"
      },
      {
        "path": "next/dist/client/components/app-router-instance.js",
        "bytes": 11229,
        "sha256": "679a2c335d4a849eb14c997d80ddd356fbd7789f50c0777ceabd0525d1e77807"
      },
      {
        "path": "next/dist/client/components/router-reducer/router-reducer.js",
        "bytes": 2630,
        "sha256": "22b9b831dbaeda84ae94020ad23ff298435a936132136925b6f0a5a3062b6d4d"
      },
      {
        "path": "next/dist/client/components/router-reducer/reducers/server-action-reducer.js",
        "bytes": 20696,
        "sha256": "45d9f7de636d847174881f3005082d5bce90399c745fba2dc3fd4ea402832950"
      },
      {
        "path": "next/dist/shared/lib/server-reference-info.js",
        "bytes": 2130,
        "sha256": "f2d96534f7dcf77c1f951112f3b4bde9728e36a1a6425928cf8b7f4b4a5cf9de"
      },
      {
        "path": "next/dist/server/app-render/action-handler.js",
        "bytes": 60411,
        "sha256": "f60960b2a15f7ec07e37e9d745ffd185763519d1693e41f39010782ccaf910cc"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.browser.js",
        "bytes": 254,
        "sha256": "4225884493381174db42ea47deef8b52ec41e358e63b49acd4929fe2f97f7a69"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.node.js",
        "bytes": 248,
        "sha256": "704a07592993924515710e08c9365e8d6b49d96df54166b869f0210d004b8685"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/server.node.js",
        "bytes": 849,
        "sha256": "218c48074fc0737329d0db31603fa0194d659f980b12c1920c88aa644e07d906"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js",
        "bytes": 66327,
        "sha256": "538d7566cd8471ce95b60c3204131e862c92e76f663d16e079b1b559a0b99fd7"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js",
        "bytes": 78295,
        "sha256": "163f82ee5a33e3616f6e3561ee932baaa8240a97e37470aa8ac6d18dd37b3255"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js",
        "bytes": 134763,
        "sha256": "5f7c1756783d12f6145dd368ae29a2d4831b4f0b3727786cb4fe3a00e7c121e1"
      }
    ]
  },
  {
    "id": "original-team-admin-guard-4b-v1",
    "binarySource": "4b911c1788b1f8b41d893c38fb6d0c644c41ec1c",
    "manifestSha256": "510d800e5d84a9a7859b5e59cb5187c25ac45891a910a63411f64a2bd6154e0d",
    "buildRecordSha256": "d4f596b441757de46ffda618d524ba50196772b10183877c8fbba0a2481736f0",
    "registrySha256": "b49e57fec2744af0088fc45bf263c8cf16872a9fb5b23efb64dc1e0f77c12bcd",
    "actionHeaderSha256": "2afdd2c7f1a1f2a9c5722394d5f55b9971b7b350c86100f5c85fbda9b7c0f126",
    "appFiles": [
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/page.tsx",
        "gitBlob": "b081db8a3018bdcb34932d8eab0d7b9f380c02b8",
        "canonicalLfSha256": "54253fff67a4e10b1b9eb4b43e11ddfdd746de51224e4fa472b7b88d3d759793"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/team-performance/page.tsx",
        "gitBlob": "f7458cf92f0ef2db6304439088ea9173dcb61985",
        "canonicalLfSha256": "69edc9b5a312b33906d6d606f947fb0d03647db64359ac0e42a4acb79b0bed91"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/actions.ts",
        "gitBlob": "9f281b436e86d9555f4562990d87b98ad7519407",
        "canonicalLfSha256": "ca8984fd0f173866eed151ecd037d1b36ee7ed869cd328bcea8689f976099472"
      },
      {
        "path": "apps/webapp/src/lib/effect/services/analytics.service.ts",
        "gitBlob": "aa5bb31705ecb9ac423f729fcc79b57efa045573",
        "canonicalLfSha256": "a2b868807eb10691dcd4b7f90583ed7076ed5e2312e3cdac8fea6df11bd8ef38"
      },
      {
        "path": "apps/webapp/src/lib/effect/result.ts",
        "gitBlob": "5c8cc57d829d33f0019ddb76820632c0dcde6e28",
        "canonicalLfSha256": "ac91c4720ac557fae05a5555df97b65a92af8b25c9750a0f5f4617ce6cb6f57a"
      },
      {
        "path": "apps/webapp/src/lib/analytics/date-ranges.ts",
        "gitBlob": "930365fe7bd9ce19530dfe1b702a048dfd0fca7c",
        "canonicalLfSha256": "095a81ae8f4e87f2f640baa489d487d6dff6465613444d192dffdfe2c2190c1f"
      },
      {
        "path": "apps/webapp/src/lib/analytics/types.ts",
        "gitBlob": "67644543cb2527464c9a4d788917c7286e5a9ef2",
        "canonicalLfSha256": "dad4e4d3c3d23d22f23132ff9b6b8abd4456df8d52310ba0f6d89e795ab9a34d"
      },
      {
        "path": "apps/webapp/src/components/analytics/date-range-picker.tsx",
        "gitBlob": "423d198408a8f68fb8fc771f862b18824be9d8d3",
        "canonicalLfSha256": "9863f2737fef10ce71ee6b0f4bfcbe5b4677ed1fbc244fee95433e83b0d70bf0"
      },
      {
        "path": "apps/webapp/src/components/reports/date-range-picker.tsx",
        "gitBlob": "18c2db57eb55af1e990fda2a8c84afa2c0645317",
        "canonicalLfSha256": "a344338209c40c0bade3fb8b55314c36815ccf547278b2bab584c0ee528d7d7b"
      },
      {
        "path": "apps/webapp/src/lib/reports/date-ranges.ts",
        "gitBlob": "14c82432031f4a1bc2cf98b89151e959433501ba",
        "canonicalLfSha256": "0ab5c18bfa3e6a9c221875c90c5481c96108579c33f552a741a5a624e06f00a4"
      },
      {
        "path": "apps/webapp/src/lib/reports/report-date-range.ts",
        "gitBlob": "7be5b52e66e4e7b2969e49c01d776baf5ea4ab8e",
        "canonicalLfSha256": "a35fa98350fb716ef89d9b726af28bf4e330cd29cff8e222dbe11eb7e999187e"
      },
      {
        "path": "apps/webapp/src/lib/reports/types.ts",
        "gitBlob": "535752e061571025d8121116627bb539f66eb2db",
        "canonicalLfSha256": "2d5c79753dab7987ff92ba70cbb09f557998bc25c80574d03cb188ad49e9f651"
      },
      {
        "path": "apps/webapp/src/lib/datetime/temporal-core.ts",
        "gitBlob": "965c40a9034a3643e185bcaf5d631d530186dd25",
        "canonicalLfSha256": "340864dae1f59706b4d3eb59227e0f83136b3f8bb22a8bb84f15b3ef38608226"
      },
      {
        "path": "apps/webapp/src/lib/timezone/validation.ts",
        "gitBlob": "cc66071cd8d223cb7feea53edb1288636f5847b3",
        "canonicalLfSha256": "630dd41244f4bcf5c2833d9cc7a2c1dec0811c2bc5ebbbbe1b02d26c28b54b7d"
      }
    ],
    "frameworkFiles": [
      {
        "path": "next/package.json",
        "bytes": 3188,
        "sha256": "440efba874450dc997b2c3bf9efa4c3c4835abbc40d65442e94a7c69f4bad031"
      },
      {
        "path": "next/dist/client/app-call-server.js",
        "bytes": 1538,
        "sha256": "f0e9fc00ebb81a3b264c9a4e34b4e6d984dae3055cbea15e2e10f7e3f55997fe"
      },
      {
        "path": "next/dist/client/sequential-call-server.js",
        "bytes": 1859,
        "sha256": "fb04a49cedc4706c7449c7087255b2027fc7893e79d70c709e14d67e516e95e2"
      },
      {
        "path": "next/dist/client/components/use-action-queue.js",
        "bytes": 5940,
        "sha256": "b0495a960d3312966950b78399676dedece7c646ba84fa2543142a3744e1e2ba"
      },
      {
        "path": "next/dist/client/components/app-router-instance.js",
        "bytes": 11229,
        "sha256": "679a2c335d4a849eb14c997d80ddd356fbd7789f50c0777ceabd0525d1e77807"
      },
      {
        "path": "next/dist/client/components/router-reducer/router-reducer.js",
        "bytes": 2630,
        "sha256": "22b9b831dbaeda84ae94020ad23ff298435a936132136925b6f0a5a3062b6d4d"
      },
      {
        "path": "next/dist/client/components/router-reducer/reducers/server-action-reducer.js",
        "bytes": 20696,
        "sha256": "45d9f7de636d847174881f3005082d5bce90399c745fba2dc3fd4ea402832950"
      },
      {
        "path": "next/dist/shared/lib/server-reference-info.js",
        "bytes": 2130,
        "sha256": "f2d96534f7dcf77c1f951112f3b4bde9728e36a1a6425928cf8b7f4b4a5cf9de"
      },
      {
        "path": "next/dist/server/app-render/action-handler.js",
        "bytes": 60411,
        "sha256": "f60960b2a15f7ec07e37e9d745ffd185763519d1693e41f39010782ccaf910cc"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.browser.js",
        "bytes": 254,
        "sha256": "4225884493381174db42ea47deef8b52ec41e358e63b49acd4929fe2f97f7a69"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.node.js",
        "bytes": 248,
        "sha256": "704a07592993924515710e08c9365e8d6b49d96df54166b869f0210d004b8685"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/server.node.js",
        "bytes": 849,
        "sha256": "218c48074fc0737329d0db31603fa0194d659f980b12c1920c88aa644e07d906"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js",
        "bytes": 66327,
        "sha256": "538d7566cd8471ce95b60c3204131e862c92e76f663d16e079b1b559a0b99fd7"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js",
        "bytes": 78295,
        "sha256": "163f82ee5a33e3616f6e3561ee932baaa8240a97e37470aa8ac6d18dd37b3255"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js",
        "bytes": 134763,
        "sha256": "5f7c1756783d12f6145dd368ae29a2d4831b4f0b3727786cb4fe3a00e7c121e1"
      }
    ]
  },
  {
    "id": "original-team-advisory-lifetime-c6ee-v1",
    "binarySource": "c6ee0fb4e941a508901e01fbec5954595715b490",
    "manifestSha256": "65c828a343a05dc1a7d8d890d98dd371ca22818e7c26d3b0d18c0714f315517b",
    "buildRecordSha256": "6e5af2398c56a5df9e8907407643f39f9d000d60ca9e3615c1895161d00c00d3",
    "registrySha256": "05d1f1a5398c5a26a331a1e363ac8acd807c4922b2977265b90dd12b3e93f808",
    "actionHeaderSha256": "07317cb15208dc388be8863e1860c7dba52ad3683881f1f16559ff796731c824",
    "appFiles": [
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/page.tsx",
        "gitBlob": "b081db8a3018bdcb34932d8eab0d7b9f380c02b8",
        "canonicalLfSha256": "54253fff67a4e10b1b9eb4b43e11ddfdd746de51224e4fa472b7b88d3d759793"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/team-performance/page.tsx",
        "gitBlob": "f7458cf92f0ef2db6304439088ea9173dcb61985",
        "canonicalLfSha256": "69edc9b5a312b33906d6d606f947fb0d03647db64359ac0e42a4acb79b0bed91"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/actions.ts",
        "gitBlob": "9f281b436e86d9555f4562990d87b98ad7519407",
        "canonicalLfSha256": "ca8984fd0f173866eed151ecd037d1b36ee7ed869cd328bcea8689f976099472"
      },
      {
        "path": "apps/webapp/src/lib/effect/services/analytics.service.ts",
        "gitBlob": "aa5bb31705ecb9ac423f729fcc79b57efa045573",
        "canonicalLfSha256": "a2b868807eb10691dcd4b7f90583ed7076ed5e2312e3cdac8fea6df11bd8ef38"
      },
      {
        "path": "apps/webapp/src/lib/effect/result.ts",
        "gitBlob": "5c8cc57d829d33f0019ddb76820632c0dcde6e28",
        "canonicalLfSha256": "ac91c4720ac557fae05a5555df97b65a92af8b25c9750a0f5f4617ce6cb6f57a"
      },
      {
        "path": "apps/webapp/src/lib/analytics/date-ranges.ts",
        "gitBlob": "930365fe7bd9ce19530dfe1b702a048dfd0fca7c",
        "canonicalLfSha256": "095a81ae8f4e87f2f640baa489d487d6dff6465613444d192dffdfe2c2190c1f"
      },
      {
        "path": "apps/webapp/src/lib/analytics/types.ts",
        "gitBlob": "67644543cb2527464c9a4d788917c7286e5a9ef2",
        "canonicalLfSha256": "dad4e4d3c3d23d22f23132ff9b6b8abd4456df8d52310ba0f6d89e795ab9a34d"
      },
      {
        "path": "apps/webapp/src/components/analytics/date-range-picker.tsx",
        "gitBlob": "423d198408a8f68fb8fc771f862b18824be9d8d3",
        "canonicalLfSha256": "9863f2737fef10ce71ee6b0f4bfcbe5b4677ed1fbc244fee95433e83b0d70bf0"
      },
      {
        "path": "apps/webapp/src/components/reports/date-range-picker.tsx",
        "gitBlob": "18c2db57eb55af1e990fda2a8c84afa2c0645317",
        "canonicalLfSha256": "a344338209c40c0bade3fb8b55314c36815ccf547278b2bab584c0ee528d7d7b"
      },
      {
        "path": "apps/webapp/src/lib/reports/date-ranges.ts",
        "gitBlob": "14c82432031f4a1bc2cf98b89151e959433501ba",
        "canonicalLfSha256": "0ab5c18bfa3e6a9c221875c90c5481c96108579c33f552a741a5a624e06f00a4"
      },
      {
        "path": "apps/webapp/src/lib/reports/report-date-range.ts",
        "gitBlob": "7be5b52e66e4e7b2969e49c01d776baf5ea4ab8e",
        "canonicalLfSha256": "a35fa98350fb716ef89d9b726af28bf4e330cd29cff8e222dbe11eb7e999187e"
      },
      {
        "path": "apps/webapp/src/lib/reports/types.ts",
        "gitBlob": "535752e061571025d8121116627bb539f66eb2db",
        "canonicalLfSha256": "2d5c79753dab7987ff92ba70cbb09f557998bc25c80574d03cb188ad49e9f651"
      },
      {
        "path": "apps/webapp/src/lib/datetime/temporal-core.ts",
        "gitBlob": "965c40a9034a3643e185bcaf5d631d530186dd25",
        "canonicalLfSha256": "340864dae1f59706b4d3eb59227e0f83136b3f8bb22a8bb84f15b3ef38608226"
      },
      {
        "path": "apps/webapp/src/lib/timezone/validation.ts",
        "gitBlob": "cc66071cd8d223cb7feea53edb1288636f5847b3",
        "canonicalLfSha256": "630dd41244f4bcf5c2833d9cc7a2c1dec0811c2bc5ebbbbe1b02d26c28b54b7d"
      }
    ],
    "frameworkFiles": [
      {
        "path": "next/package.json",
        "bytes": 3188,
        "sha256": "440efba874450dc997b2c3bf9efa4c3c4835abbc40d65442e94a7c69f4bad031"
      },
      {
        "path": "next/dist/client/app-call-server.js",
        "bytes": 1538,
        "sha256": "f0e9fc00ebb81a3b264c9a4e34b4e6d984dae3055cbea15e2e10f7e3f55997fe"
      },
      {
        "path": "next/dist/client/sequential-call-server.js",
        "bytes": 1859,
        "sha256": "fb04a49cedc4706c7449c7087255b2027fc7893e79d70c709e14d67e516e95e2"
      },
      {
        "path": "next/dist/client/components/use-action-queue.js",
        "bytes": 5940,
        "sha256": "b0495a960d3312966950b78399676dedece7c646ba84fa2543142a3744e1e2ba"
      },
      {
        "path": "next/dist/client/components/app-router-instance.js",
        "bytes": 11229,
        "sha256": "679a2c335d4a849eb14c997d80ddd356fbd7789f50c0777ceabd0525d1e77807"
      },
      {
        "path": "next/dist/client/components/router-reducer/router-reducer.js",
        "bytes": 2630,
        "sha256": "22b9b831dbaeda84ae94020ad23ff298435a936132136925b6f0a5a3062b6d4d"
      },
      {
        "path": "next/dist/client/components/router-reducer/reducers/server-action-reducer.js",
        "bytes": 20696,
        "sha256": "45d9f7de636d847174881f3005082d5bce90399c745fba2dc3fd4ea402832950"
      },
      {
        "path": "next/dist/shared/lib/server-reference-info.js",
        "bytes": 2130,
        "sha256": "f2d96534f7dcf77c1f951112f3b4bde9728e36a1a6425928cf8b7f4b4a5cf9de"
      },
      {
        "path": "next/dist/server/app-render/action-handler.js",
        "bytes": 60411,
        "sha256": "f60960b2a15f7ec07e37e9d745ffd185763519d1693e41f39010782ccaf910cc"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.browser.js",
        "bytes": 254,
        "sha256": "4225884493381174db42ea47deef8b52ec41e358e63b49acd4929fe2f97f7a69"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.node.js",
        "bytes": 248,
        "sha256": "704a07592993924515710e08c9365e8d6b49d96df54166b869f0210d004b8685"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/server.node.js",
        "bytes": 849,
        "sha256": "218c48074fc0737329d0db31603fa0194d659f980b12c1920c88aa644e07d906"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js",
        "bytes": 66327,
        "sha256": "538d7566cd8471ce95b60c3204131e862c92e76f663d16e079b1b559a0b99fd7"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js",
        "bytes": 78295,
        "sha256": "163f82ee5a33e3616f6e3561ee932baaa8240a97e37470aa8ac6d18dd37b3255"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js",
        "bytes": 134763,
        "sha256": "5f7c1756783d12f6145dd368ae29a2d4831b4f0b3727786cb4fe3a00e7c121e1"
      }
    ]
  },
  {
    "id": "original-team-web-clock-status-2ef-v1",
    "binarySource": "2ef3b3f17ea61d65570f23c46f92d1d320f5ef25",
    "manifestSha256": "4a494ab798bcc6cd6b438673bdf2b5fd6d3a8a8b11e1a4650bb807e7885c99f8",
    "buildRecordSha256": "e941aa3c8cfd111a9bcf3a84b40556258c790318c35346d767e367ccefe6ff46",
    "registrySha256": "c16613818be250574e87f121ac596c87b8cd50b3bbaa0f1d732f750bae6d1f09",
    "actionHeaderSha256": "75e71e23f888beb5e9d0251a1b7ef1a57454b599069d6c5b451dcd1293a9dc59",
    "appFiles": [
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/page.tsx",
        "gitBlob": "b081db8a3018bdcb34932d8eab0d7b9f380c02b8",
        "canonicalLfSha256": "54253fff67a4e10b1b9eb4b43e11ddfdd746de51224e4fa472b7b88d3d759793"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/team-performance/page.tsx",
        "gitBlob": "f7458cf92f0ef2db6304439088ea9173dcb61985",
        "canonicalLfSha256": "69edc9b5a312b33906d6d606f947fb0d03647db64359ac0e42a4acb79b0bed91"
      },
      {
        "path": "apps/webapp/src/app/[locale]/(app)/analytics/actions.ts",
        "gitBlob": "9f281b436e86d9555f4562990d87b98ad7519407",
        "canonicalLfSha256": "ca8984fd0f173866eed151ecd037d1b36ee7ed869cd328bcea8689f976099472"
      },
      {
        "path": "apps/webapp/src/lib/effect/services/analytics.service.ts",
        "gitBlob": "aa5bb31705ecb9ac423f729fcc79b57efa045573",
        "canonicalLfSha256": "a2b868807eb10691dcd4b7f90583ed7076ed5e2312e3cdac8fea6df11bd8ef38"
      },
      {
        "path": "apps/webapp/src/lib/effect/result.ts",
        "gitBlob": "5c8cc57d829d33f0019ddb76820632c0dcde6e28",
        "canonicalLfSha256": "ac91c4720ac557fae05a5555df97b65a92af8b25c9750a0f5f4617ce6cb6f57a"
      },
      {
        "path": "apps/webapp/src/lib/analytics/date-ranges.ts",
        "gitBlob": "930365fe7bd9ce19530dfe1b702a048dfd0fca7c",
        "canonicalLfSha256": "095a81ae8f4e87f2f640baa489d487d6dff6465613444d192dffdfe2c2190c1f"
      },
      {
        "path": "apps/webapp/src/lib/analytics/types.ts",
        "gitBlob": "67644543cb2527464c9a4d788917c7286e5a9ef2",
        "canonicalLfSha256": "dad4e4d3c3d23d22f23132ff9b6b8abd4456df8d52310ba0f6d89e795ab9a34d"
      },
      {
        "path": "apps/webapp/src/components/analytics/date-range-picker.tsx",
        "gitBlob": "423d198408a8f68fb8fc771f862b18824be9d8d3",
        "canonicalLfSha256": "9863f2737fef10ce71ee6b0f4bfcbe5b4677ed1fbc244fee95433e83b0d70bf0"
      },
      {
        "path": "apps/webapp/src/components/reports/date-range-picker.tsx",
        "gitBlob": "18c2db57eb55af1e990fda2a8c84afa2c0645317",
        "canonicalLfSha256": "a344338209c40c0bade3fb8b55314c36815ccf547278b2bab584c0ee528d7d7b"
      },
      {
        "path": "apps/webapp/src/lib/reports/date-ranges.ts",
        "gitBlob": "14c82432031f4a1bc2cf98b89151e959433501ba",
        "canonicalLfSha256": "0ab5c18bfa3e6a9c221875c90c5481c96108579c33f552a741a5a624e06f00a4"
      },
      {
        "path": "apps/webapp/src/lib/reports/report-date-range.ts",
        "gitBlob": "7be5b52e66e4e7b2969e49c01d776baf5ea4ab8e",
        "canonicalLfSha256": "a35fa98350fb716ef89d9b726af28bf4e330cd29cff8e222dbe11eb7e999187e"
      },
      {
        "path": "apps/webapp/src/lib/reports/types.ts",
        "gitBlob": "535752e061571025d8121116627bb539f66eb2db",
        "canonicalLfSha256": "2d5c79753dab7987ff92ba70cbb09f557998bc25c80574d03cb188ad49e9f651"
      },
      {
        "path": "apps/webapp/src/lib/datetime/temporal-core.ts",
        "gitBlob": "965c40a9034a3643e185bcaf5d631d530186dd25",
        "canonicalLfSha256": "340864dae1f59706b4d3eb59227e0f83136b3f8bb22a8bb84f15b3ef38608226"
      },
      {
        "path": "apps/webapp/src/lib/timezone/validation.ts",
        "gitBlob": "cc66071cd8d223cb7feea53edb1288636f5847b3",
        "canonicalLfSha256": "630dd41244f4bcf5c2833d9cc7a2c1dec0811c2bc5ebbbbe1b02d26c28b54b7d"
      }
    ],
    "frameworkFiles": [
      {
        "path": "next/package.json",
        "bytes": 3188,
        "sha256": "440efba874450dc997b2c3bf9efa4c3c4835abbc40d65442e94a7c69f4bad031"
      },
      {
        "path": "next/dist/client/app-call-server.js",
        "bytes": 1538,
        "sha256": "f0e9fc00ebb81a3b264c9a4e34b4e6d984dae3055cbea15e2e10f7e3f55997fe"
      },
      {
        "path": "next/dist/client/sequential-call-server.js",
        "bytes": 1859,
        "sha256": "fb04a49cedc4706c7449c7087255b2027fc7893e79d70c709e14d67e516e95e2"
      },
      {
        "path": "next/dist/client/components/use-action-queue.js",
        "bytes": 5940,
        "sha256": "b0495a960d3312966950b78399676dedece7c646ba84fa2543142a3744e1e2ba"
      },
      {
        "path": "next/dist/client/components/app-router-instance.js",
        "bytes": 11229,
        "sha256": "679a2c335d4a849eb14c997d80ddd356fbd7789f50c0777ceabd0525d1e77807"
      },
      {
        "path": "next/dist/client/components/router-reducer/router-reducer.js",
        "bytes": 2630,
        "sha256": "22b9b831dbaeda84ae94020ad23ff298435a936132136925b6f0a5a3062b6d4d"
      },
      {
        "path": "next/dist/client/components/router-reducer/reducers/server-action-reducer.js",
        "bytes": 20696,
        "sha256": "45d9f7de636d847174881f3005082d5bce90399c745fba2dc3fd4ea402832950"
      },
      {
        "path": "next/dist/shared/lib/server-reference-info.js",
        "bytes": 2130,
        "sha256": "f2d96534f7dcf77c1f951112f3b4bde9728e36a1a6425928cf8b7f4b4a5cf9de"
      },
      {
        "path": "next/dist/server/app-render/action-handler.js",
        "bytes": 60411,
        "sha256": "f60960b2a15f7ec07e37e9d745ffd185763519d1693e41f39010782ccaf910cc"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.browser.js",
        "bytes": 254,
        "sha256": "4225884493381174db42ea47deef8b52ec41e358e63b49acd4929fe2f97f7a69"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/client.node.js",
        "bytes": 248,
        "sha256": "704a07592993924515710e08c9365e8d6b49d96df54166b869f0210d004b8685"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/server.node.js",
        "bytes": 849,
        "sha256": "218c48074fc0737329d0db31603fa0194d659f980b12c1920c88aa644e07d906"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js",
        "bytes": 66327,
        "sha256": "538d7566cd8471ce95b60c3204131e862c92e76f663d16e079b1b559a0b99fd7"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js",
        "bytes": 78295,
        "sha256": "163f82ee5a33e3616f6e3561ee932baaa8240a97e37470aa8ac6d18dd37b3255"
      },
      {
        "path": "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js",
        "bytes": 134763,
        "sha256": "5f7c1756783d12f6145dd368ae29a2d4831b4f0b3727786cb4fe3a00e7c121e1"
      }
    ]
  }
]);
export function knownTemporaryValueObservation(value) {
	try { return ownData(value, ["protocol", "replayHeader", "documentJournal","annualTeam"]) && ["protocol","replayHeader","documentJournal"].every(key=>value[key]===temporaryValueObservation[key]) && ownData(value.annualTeam,Object.keys(temporaryValueObservation.annualTeam)) && Object.entries(temporaryValueObservation.annualTeam).every(([key,expected])=>value.annualTeam[key]===expected); }
	catch { return false; }
}
/** Null explicitly declares unsupported T authority. A configured Original is exact, not a descendant exception. */
export function knownOriginalTeamSourceConfiguration(value, compiledBuild, compiledManifestSha256) {
	try {
		if (value === null) return true;
		if (!ownData(value, ["protocol", "profileId", "phase", "compiledBuild", "compiledManifestSha256", "buildRecordPath", "buildRecordSha256"]) ||
			value.protocol !== "original-team-source-configuration-v1" || value.phase !== "baseline" ||
			typeof value.buildRecordPath !== "string" || value.buildRecordPath.length < 1 || value.buildRecordPath.length > 4096) return false;
		const profile = originalTeamTemporaryProfiles.find(row => row.id === value.profileId);
		return Boolean(profile && value.compiledBuild === profile.binarySource && value.compiledManifestSha256 === profile.manifestSha256 &&
			value.buildRecordSha256 === profile.buildRecordSha256 && (compiledBuild === undefined || compiledBuild === profile.binarySource) &&
			(compiledManifestSha256 === undefined || compiledManifestSha256 === profile.manifestSha256));
	} catch { return false; }
}
const qualifications = new WeakMap();
const factKeys = ["protocol", "profileId", "phase", "binarySource", "manifestSha256", "buildRecordSha256", "registrySha256", "actionHeaderSha256", "selectedActionMatches", "concurrentRouterQueue", "cachedNavigations", "appFiles", "frameworkFiles"];
const ownData = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
	Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"));
const sameRows = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every((row, index) =>
	ownData(row, Object.keys(expected[index])) && Object.entries(expected[index]).every(([key, value]) => row[key] === value));

/** Closed factual receipt validation never mints a live source capability. */
export function knownOriginalTeamSourceFacts(facts) {
	try {
		if (!ownData(facts, factKeys)) return false;
		const profile = originalTeamTemporaryProfiles.find(value => value.id === facts.profileId);
		return Boolean(profile && facts.protocol === "original-team-temporary-source-facts-v1" && facts.phase === "baseline" &&
			["binarySource", "manifestSha256", "buildRecordSha256", "registrySha256", "actionHeaderSha256"].every(key => facts[key] === profile[key]) &&
			facts.selectedActionMatches === 1 && facts.concurrentRouterQueue === false && facts.cachedNavigations === true &&
			sameRows(facts.appFiles, profile.appFiles) && sameRows(facts.frameworkFiles, profile.frameworkFiles));
	} catch { return false; }
}
export const isOriginalTeamSourceQualification = value => value !== null && typeof value === "object" && qualifications.has(value);
export function originalTeamSourceFacts(qualification) {
	const facts = isOriginalTeamSourceQualification(qualification) ? qualifications.get(qualification) : null;
	return facts ? deepFreeze(structuredClone(facts)) : null;
}

/** RAM-only data projection, never a request, source, temporary-map or semantic permission. */
export function projectInertDateRangeRequest(descriptor) {
	const inert = readInertDateRangeRequestValue(descriptor);
	if (!inert) return null;
	const projected = {}, fields = [];
	for (const field of rangeFields) {
		const item = inert[field], date = item.kind === "react-date", text = date ? item.iso : item.text;
		projected[field] = date ? "$D" + text : text.startsWith("$") ? "$" + text : text;
		fields.push({ field, kind: item.kind, ...(date ? { canonical: true } : {}), utf16Units: text.length, utf8Bytes: Buffer.byteLength(text), sha256: sha(text), protocolEdges: false });
	}
	return deepFreeze({ value: projected, facts: { protocol: "closed-inert-date-range-type-facts-v1", rootKind: "own-object", fieldCount: 5, nodes: 6, depth: 2,
		fields, projectionSha256: sha(mixedOwnedJSONString(projected)) } });
}
export function knownClosedDateRangeTypeFacts(facts) {
	try {
		if (!ownData(facts, ["protocol", "rootKind", "fieldCount", "nodes", "depth", "fields", "projectionSha256"]) ||
			facts.protocol !== "closed-inert-date-range-type-facts-v1" || facts.rootKind !== "own-object" || facts.fieldCount !== 5 || facts.nodes !== 6 || facts.depth !== 2 ||
			!digest(facts.projectionSha256) || !Array.isArray(facts.fields) || facts.fields.length !== 5) return false;
		return facts.fields.every((row, index) => {
			const date = index < 2;
			return ownData(row, ["field", "kind", ...(date ? ["canonical"] : []), "utf16Units", "utf8Bytes", "sha256", "protocolEdges"]) &&
				row.field === rangeFields[index] && row.kind === (date ? "react-date" : "literal-string") && row.protocolEdges === false && digest(row.sha256) &&
				Number.isSafeInteger(row.utf16Units) && row.utf16Units >= 0 && Number.isSafeInteger(row.utf8Bytes) && row.utf8Bytes >= row.utf16Units && row.utf8Bytes <= 16384 &&
				(date ? row.canonical === true && [24, 27].includes(row.utf16Units) && row.utf8Bytes === row.utf16Units : row.utf8Bytes !== 0 || row.sha256 === sha(""));
		});
	} catch { return false; }
}

export const teamTemporaryValueStoreLimits = Object.freeze({ records: 10000, retainedBytes: 32 * 1024 * 1024, payloadReservation: 262144, metadataReservation: 2048 });
const valueStores = new WeakMap(), valueHandles = new WeakMap(), inspectionOwners = new WeakMap(), descriptorOwners = new WeakMap();

/** Bounded RAM ownership only. This store and its handles supply NO source or producer authority. */
export function createTeamTemporaryValueStore({ contextId, reserve, release }) {
	if (typeof contextId !== "string" || !/^[A-Za-z0-9:_.-]{1,256}$/.test(contextId) || typeof reserve !== "function" || typeof release !== "function")
		throw Error("Known bounded temporary-value storage ownership is required.");
	const limits = teamTemporaryValueStoreLimits, records = new Map(), owner = {};
	let closed = false, errors = 0, overflow = 0, unavailable = 0, payloadBytes = 0, metadataBytes = 0, pendingConsumers = 0, budgetKnown = true, usedBodyCount = 0;
	const forgetUnowned = descriptor => { if (!descriptorOwners.has(descriptor)) forgetInertDateRangeRequestValue(descriptor); };
	const releaseRecord = record => {
		if (record.releaseAttempted || record.pending) { errors++; return false; }
		record.releaseAttempted = true;
		if (!forgetInertDateRangeRequestValue(record.descriptor)) errors++;
		descriptorOwners.delete(record.descriptor);
		record.descriptor = null; record.projection = null; record.valueForgotten = true;
		try { release(limits.payloadReservation); payloadBytes -= limits.payloadReservation; record.released = true; return true; }
		catch { errors++; budgetKnown = false; record.releaseUnknown = true; return false; }
	};
	const recordFor = handle => {
		const held = handle !== null && typeof handle === "object" ? valueHandles.get(handle) : null;
		return held?.owner === owner ? held.record : null;
	};
	const api = Object.freeze({
		retain({ id, descriptor }) {
			if (closed || !budgetKnown || typeof id !== "string" || !/^[a-f0-9]{32}\.[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id.slice(33))) ||
				records.has(id) || descriptor === null || typeof descriptor !== "object" || descriptorOwners.has(descriptor) || !readInertDateRangeRequestValue(descriptor)) {
				errors++; unavailable++; forgetUnowned(descriptor); return null;
			}
			const bytes = limits.payloadReservation + limits.metadataReservation;
			if (records.size >= limits.records || payloadBytes + metadataBytes + bytes > limits.retainedBytes) {
				overflow++; unavailable++; forgetUnowned(descriptor); return null;
			}
			let reserved;
			try { reserved = reserve(bytes); } catch { errors++; budgetKnown = false; unavailable++; forgetUnowned(descriptor); return null; }
			if (reserved !== true) {
				if (reserved === false) overflow++;
				else { errors++; budgetKnown = false; }
				unavailable++; forgetUnowned(descriptor); return null;
			}
			payloadBytes += limits.payloadReservation; metadataBytes += limits.metadataReservation;
			const projection = projectInertDateRangeRequest(descriptor), requestFacts = deepFreeze(structuredClone(descriptor));
			if (!projection || Buffer.byteLength(mixedOwnedJSONString({ id, contextId, requestFacts, typeFacts: projection?.facts })) > limits.metadataReservation) {
				errors++; unavailable++; forgetUnowned(descriptor);
				try { release(bytes); payloadBytes -= limits.payloadReservation; metadataBytes -= limits.metadataReservation; } catch { errors++; budgetKnown = false; }
				return null;
			}
			const record = { id, contextId, descriptor, projection, requestFacts, typeFacts: projection.facts, pending: 0, released: false, releaseAttempted: false, valueForgotten: false, releaseUnknown: false, everUsed:false, usedBodies:new Map() };
			const handle = Object.freeze({ protocol: "private-unqualified-team-request-value-v1", contextId, id });
			records.set(id, record); descriptorOwners.set(descriptor, owner); valueHandles.set(handle, { owner, record });
			return handle;
		},
		beginInspection(handle) {
			const record = recordFor(handle);
			if (closed || !record || record.releaseAttempted) { errors++; return null; }
			const token = Object.freeze({ protocol: "private-team-value-inspection-v1", contextId, id: record.id });
			inspectionOwners.set(token, { owner, record }); record.pending++; pendingConsumers++;
			return token;
		},
		finishInspection(token) {
			const held = token !== null && typeof token === "object" ? inspectionOwners.get(token) : null;
			if (held?.owner !== owner || held.record.pending < 1) { errors++; return false; }
			inspectionOwners.delete(token); held.record.pending--; pendingConsumers--;
			if (closed && held.record.pending === 0 && !held.record.releaseAttempted) releaseRecord(held.record);
			return true;
		},
		release(handle) { const record = recordFor(handle); if (!record) { errors++; return false; } return releaseRecord(record); },
		close() {
			if (closed) return;
			closed = true;
			for (const record of records.values()) {
				if (record.releaseAttempted) continue;
				if (record.pending) errors++;
				else releaseRecord(record);
			}
		},
		snapshot() { return {
			protocol: "bounded-unqualified-team-values-v1", contextId, sourceBound: false, acceptanceClaim: "none", closed, budgetKnown,
			errors, overflow, unavailable, pendingConsumers, payloadRetainedBytes: budgetKnown ? payloadBytes : null, metadataRetainedBytes: budgetKnown ? metadataBytes : null,
			usage:{protocol:"actual-private-value-use-census-v1",contextId,observed:usedBodyCount},
            rows: mixedOwnedArray(records.size,()=>[...records.values()].map(({ id, requestFacts, typeFacts, pending, released, valueForgotten, releaseUnknown,everUsed,usedBodies }) => ({ id, requestFacts, typeFacts, pendingConsumers: pending, released, valueForgotten, releaseUnknown,everUsed,usedBodies:mixedOwnedRows(()=>usedBodies.values(),row=>row) })),{bytesPerEntry:8192,records:records.size}),
		}; },
	});
	valueStores.set(api, { owner, contextId, recordFor,observeUse(handle,bodySha256,decodedBytes,bindingSha256){
		const record=recordFor(handle);if(!record || record.releaseAttempted || !digest(bodySha256) || !digest(bindingSha256)){errors++;return false;}
		const prior=record.usedBodies.get(bodySha256),fact={bodySha256,decodedBytes,bindingSha256};if(prior){if(!sameJSON(prior,fact)){errors++;return false;}return true;}
		if(usedBodyCount>=10000 || payloadBytes+metadataBytes+2048>limits.retainedBytes){overflow++;return false;}
		let answer;try{answer=reserve(2048);}catch{errors++;budgetKnown=false;return false;}
		if(answer!==true){if(answer===false)overflow++;else{errors++;budgetKnown=false;}return false;}
		metadataBytes+=2048;record.everUsed=true;record.usedBodies.set(bodySha256,Object.freeze(fact));usedBodyCount++;return true;
	} });
	return api;
}

const dispatchJournals = new WeakMap(), dispatchHandles = new WeakMap();
const operatorQualifications = new WeakMap(), uiProducerCuts = new WeakMap(), requestAuthorities = new WeakMap();
const technicalId = value => typeof value === "string" && /^[A-Za-z0-9:_.-]{1,256}$/.test(value);
const teamLocale=value=>typeof value==="string" && value.length<=64 && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
/** Explicit page fields only; unresolved entity templates and non-page/static paths stay unsupported. */
export function originalTeamPageRouteContract(plan) {
 try {
  const origin=new URL(plan.origin);
  if(origin.protocol!=="http:" || !["localhost","127.0.0.1","[::1]"].includes(origin.hostname) || origin.origin!==plan.origin || !Array.isArray(plan.conditions) || plan.conditions.length<1 || plan.conditions.length>32 || !plan.conditions.every(row=>teamLocale(row.locale)) || !Array.isArray(plan.routes) || plan.routes.length<1 || plan.routes.length>64)return null;
  const locales=[...new Set(plan.conditions.map(row=>row.locale))].sort(),destinations=[],seen=new Set();
  for(const locale of locales)for(const template of ["/{locale}/analytics","/{locale}/analytics/team-performance",...plan.routes.flatMap(row=>[row.path,row.awayPath])]) {
   if(typeof template!=="string" || template.length>2048)continue;
   const path=template.replaceAll("{locale}",locale);
   if(path.length>2048 || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path) || !(path==="/"+locale || path.startsWith("/"+locale+"/")) || path.split("/")[2]==="api")continue;
   const url=new URL(path,origin);if(url.origin!==origin.origin || url.pathname!==path || url.search || url.hash)continue;
   const urlSha256=sha(url.href);if(seen.has(urlSha256))continue;if(destinations.length>=128)return null;
   seen.add(urlSha256);destinations.push({locale,fullUrlSha256:urlSha256,pathnameSha256:sha(path)});
  }
  return deepFreeze({protocol:"source-qualified-team-page-routes-v1",originSha256:sha(origin.origin),workerScriptSha256:sha(new URL("/sw.js",origin).href),rootScopeSha256:sha(new URL("/",origin).href),locales,destinations:destinations.sort((a,b)=>a.fullUrlSha256.localeCompare(b.fullUrlSha256))});
 }catch{return null;}
}
function knownTeamPageRoutes(routes) {
 return ownData(routes,["protocol","originSha256","workerScriptSha256","rootScopeSha256","locales","destinations"]) && routes.protocol==="source-qualified-team-page-routes-v1" && [routes.originSha256,routes.workerScriptSha256,routes.rootScopeSha256].every(digest) && Array.isArray(routes.locales) && routes.locales.length>=1 && routes.locales.length<=32 && routes.locales.every(teamLocale) && new Set(routes.locales).size===routes.locales.length &&
  Array.isArray(routes.destinations) && routes.destinations.length>=2 && routes.destinations.length<=128 && new Set(routes.destinations.map(row=>row.fullUrlSha256)).size===routes.destinations.length && routes.destinations.every(row=>ownData(row,["locale","fullUrlSha256","pathnameSha256"]) && routes.locales.includes(row.locale) && digest(row.fullUrlSha256) && digest(row.pathnameSha256));
}
/** Hash-only route facts are not caller identity, source authority, or a request capability. */
export function originalTeamRequestRouteFacts(operator,row) {
 try {
  const routes=operator?.pageRoutes;if(!knownTeamPageRoutes(routes) || row?.type!=="Fetch" || row.method!=="POST" || row.requestHeaderSnapshotKnown!==true || row.requestOriginSha256!==routes.originSha256)return null;
  const matches=routes.destinations.filter(route=>route.fullUrlSha256===row.fullUrlSha256 && row.headerFieldSha256?.["accept-language"]===sha(route.locale));if(matches.length!==1)return null;
  return Object.freeze({protocol:"observed-team-page-fetch-v1",resourceType:"Fetch",originSha256:routes.originSha256,...matches[0],routeContractSha256:sha(mixedOwnedJSONString(routes))});
 }catch{return null;}
}
export function knownOriginalTeamRequestRoute(facts,operator,row) {
 try {
  const expected=originalTeamRequestRouteFacts(operator,row);
  return ownData(facts,["protocol","resourceType","originSha256","locale","fullUrlSha256","pathnameSha256","routeContractSha256"]) && expected!==null && sameJSON(facts,expected);
 }catch{return false;}
}
const knownTeamRequestRouteShape=facts=>ownData(facts,["protocol","resourceType","originSha256","locale","fullUrlSha256","pathnameSha256","routeContractSha256"]) && facts.protocol==="observed-team-page-fetch-v1" && facts.resourceType==="Fetch" && teamLocale(facts.locale) && [facts.originSha256,facts.fullUrlSha256,facts.pathnameSha256,facts.routeContractSha256].every(digest);
/** File/plan qualification does not issue a request value. Every manual producer is in the frozen graph. */
export async function readOriginalTeamOperatorQualification(input) {
	try {
		const {qualification,operatorFile,protocolSources,plan}=input;
		if (!isOriginalTeamSourceQualification(qualification) || !["run-baseline.mjs", "settled-resources.mjs", "mixed-load-probe.mjs"].includes(operatorFile) ||
			!protocolSources || Object.keys(protocolSources).length > 64 || ![operatorFile, "browser-control-collector.mjs", "team-temporary-value-authority.mjs", "inert-date-range-request.mjs", "journey-steps.mjs", "trace-transport.mjs"].every(file => digest(protocolSources[file]))) throw Error();
		for (const [file, expected] of Object.entries(protocolSources)) {
			if (!/^(?:\.\.\/\.\.\/docs\/performance\/evidence\/)?[A-Za-z0-9_.-]+(?:\/[^/]+)*$/.test(file) || !digest(expected)) throw Error();
			const bytes = await readSource(new URL(file, import.meta.url));
			if (sha(bytes) !== expected) throw Error();
		}
		const text = mixedOwnedJSONString(plan);
		if (typeof text !== "string" || Buffer.byteLength(text) > 4194304) throw Error();
		const queue = [{value:JSON.parse(text),depth:0}]; let work=0;
		while(queue.length) {
			const {value,depth}=queue.pop(); if(++work>100000 || depth>64)throw Error();
			if(value && typeof value==="object")for(const [key,child]of Object.entries(value)) {
				if(["evaluate","javascript","script","function"].includes(key))throw Error();
				queue.push({value:child,depth:depth+1});
			}
		}
		const pageRoutes=originalTeamPageRouteContract(plan);if(!pageRoutes)throw Error();
		const facts=deepFreeze({protocol:"closed-team-operator-source-v1",operatorFile,protocolSources:{...protocolSources},planSha256:sha(text),executablePlanSteps:false,manualReplayHeader:teamReplayHeader,pageRoutes});
		if(Buffer.byteLength(mixedOwnedJSONString(facts))*8+2048>128*8192)throw Error();
		const result=Object.freeze({protocol:"private-team-operator-source-v1"}); operatorQualifications.set(result,{qualification,facts});return result;
	} catch { throw Error("Original team operator source qualification unavailable."); }
}
const teamPublicSources = Object.freeze([
 ["sw.js",26047,"4eb0acd7bfb93d668e073baf69304af8f91f54f9dc82664ded7530866ae8bc7a"],
 ["lib/offline-queue-db.js",18409,"a285a69270bb8c65b96b102277a24c49da8ede440ab009b7ecff5495de7bfbc1"],
 ["lib/sync-service.js",1385,"f8bfd4a69ebaf3f43e33ffeb4858523d0afd3f3988c52fc82cda6cae7f810a05"],
 ["lib/clock-command-dispatch.js",13604,"663be8d36271e9c6c0c1efd5e4188994e1e49e40bcd70f7f432526ede7014c07"],
]);
// Each entry is a whole qualified public4 revision; only the approved empty-queue SW differs.
const teamPublicSourceRevisions = Object.freeze([teamPublicSources, Object.freeze([
 ["sw.js",26569,"721215e68848d0494616c684fa7f2f43873893412a558f84864ba35d6c1dadcd"], ...teamPublicSources.slice(1),
])]);
const sourcePublicKnown = (sources, expected) => sources?.protocol === "serving-public-worker-source-metadata-v1" && sources.servingRootKnown===true && expected?.protocol==="qualified-serving-worker-sources-v1" &&
	Array.isArray(sources.files) && sources.files.length===4 && Array.isArray(expected?.files) && expected.files.length===4 &&
	sources.files.every((row,index)=>row.known===true && row.reason===null && row.file===expected.files[index].file && row.bytes===expected.files[index].bytes && row.sha256===expected.files[index].sha256) && teamPublicSourceRevisions.some(revision=>sources.files.every((row,index)=>row.file===revision[index][0] && row.bytes===revision[index][1] && row.sha256===revision[index][2]));
/** Source noninterference only. This never attests continuous controller state or closes a scope. */
export function knownOriginalTeamWorkerExtension(past,current,workerScriptSha256) {
 try {
  const known=workers=>workers?.protocol==="owned-context-worker-target-metadata-v1" && technicalId(workers.contextId) && workers.contextJoinKnown===true && digest(workers.contextIdentitySha256) && workers.installed===true && typeof workers.scopeClosed==="boolean" && workers.errors===0 && workers.overflow===0 &&
   workers.enumerationBasis==="existing-puppeteer-target-manager" && workers.controllerObservation==="not-collected" && Array.isArray(workers.events) && workers.events.length>=1 && workers.events.length<=256 && workers.events.every(row=>
    ownData(row,["targetOrdinal","event","type","urlKnown","urlSha256","originMatches","ownedWorkerScript"]) && Number.isSafeInteger(row.targetOrdinal) && row.targetOrdinal>=1 && row.targetOrdinal<=256 && ["initial","created","changed","destroyed"].includes(row.event) && row.urlKnown===true && digest(row.urlSha256) &&
    (row.type==="page" ? row.ownedWorkerScript===null && (row.originMatches===true || row.originMatches===false && row.urlSha256===sha("about:blank")) : row.type==="service_worker" && row.ownedWorkerScript===true && row.originMatches===true && row.urlSha256===workerScriptSha256));
  return digest(workerScriptSha256) && known(past) && known(current) && past.scopeClosed===false && past.contextId===current.contextId && past.contextIdentitySha256===current.contextIdentitySha256 &&
   current.events.length>=past.events.length && sameJSON(mixedOwnedSlice(current.events,0,past.events.length),past.events);
 }catch{return false;}
}
/** Disjoint positive observation regimes; unknown controller/registration facts have no regime. */
export function originalTeamControllerRegime(controller,workers,workerScriptSha256,rootScopeSha256) {
 try {
  if(!knownOriginalTeamWorkerExtension(workers,workers,workerScriptSha256) || workers.scopeClosed!==false || controller?.available!==true || controller.secureContext!==true || controller.originMatches!==true || controller.controllerIdentityStable!==true || controller.registrationOverflow!==0 || !Array.isArray(controller.registrations))return null;
  const none=row=>ownData(row,["present","known"]) && row.present===false && row.known===true;
  if(none(controller.controllerBefore) && none(controller.controllerAfter) && controller.registrationCount===0 && controller.registrations.length===0 && workers.events.every(row=>row.type==="page"))return "known-uncontrolled-page-only";
  const owned=row=>row?.present===true && row.known===true && row.ownedScript===true && row.state==="activated" && row.scriptUrlSha256===workerScriptSha256;
  if(!owned(controller.controllerBefore) || !owned(controller.controllerAfter) || controller.registrationCount!==1 || controller.registrations.length!==1)return null;
  const registration=controller.registrations[0];
  return registration.scopeKnown===true && registration.ownedRootScope===true && digest(registration.scopeSha256) && (rootScopeSha256===undefined || registration.scopeSha256===rootScopeSha256) && owned(registration.active) && none(registration.waiting) && none(registration.installing)?"owned-activated":null;
 }catch{return null;}
}
function knownTeamPrincipalHistory(principal,ack) {
 try {
  const history=principal?.progressReads;
  if(history?.protocol!=="owned-read-only-principal-operations-v1" || !Number.isSafeInteger(history.started) || history.started<1 || history.started>10000 || history.finished!==history.started || principal.pendingReads!==0 ||
   !Array.isArray(history.records) || history.records.length!==history.started || !Array.isArray(history.pending) || history.pending.length!==0)return false;
  mixedOwnedIndexWork(history.records.length);
  const ids=new Set(),starts=[],ends=[];
  for(const record of history.records){
   if(!ownData(record,["acknowledgmentOrdinal","kind","startedOrdinal","finishedOrdinal","snapshotSha256","error"]) || !Number.isSafeInteger(record.acknowledgmentOrdinal) || record.acknowledgmentOrdinal<1 || record.acknowledgmentOrdinal>10000 || ids.has(record.acknowledgmentOrdinal) ||
    record.kind!=="read-only-context-cookies-v1" || record.error!==false || !Number.isSafeInteger(record.startedOrdinal) || record.startedOrdinal<1 || !Number.isSafeInteger(record.finishedOrdinal) || record.finishedOrdinal<1 || !digest(record.snapshotSha256))return false;
   ids.add(record.acknowledgmentOrdinal);starts.push(record.startedOrdinal);ends.push(record.finishedOrdinal);
  }
  const own=ack?.principalReadOperation;
  return starts.sort((a,b)=>a-b).every((value,index)=>value===index+1) && ends.sort((a,b)=>a-b).every((value,index)=>value===index+1) && own?.acknowledgmentOrdinal===ack.checkpointOrdinal && own.snapshotSha256===ack.principalRead?.sha256 && mixedOwnedFilter(history.records,record=>sameJSON(record,own)).length===1;
 }catch{return false;}
}function knownTeamDocumentJournal(journal,contextId) {
 try {
  if(journal?.protocol!=="actual-cdp-document-journal-v1" || journal.contextId!==contextId || journal.installed!==true || typeof journal.closed!=="boolean" || journal.errors!==0 || journal.overflow!==0 ||
   !Number.isSafeInteger(journal.currentGeneration) || journal.currentGeneration<0 || !Array.isArray(journal.documents) || !Array.isArray(journal.executionEvents) || journal.documents.length+journal.executionEvents.length>10000 ||
   journal.documentEventOrdinal!==journal.documents.length || journal.executionEventOrdinal!==journal.executionEvents.length)return false;
  mixedOwnedIndexWork(journal.executionEvents.length+journal.documents.length);
  const contexts=new Map();
  for(const [index,event]of journal.executionEvents.entries()) {
   if(event.ordinal!==index+1)return false;
   if(event.event==="cleared"){if(!ownData(event,["ordinal","event"]))return false;contexts.clear();}
   else if(event.event==="destroyed"){if(!ownData(event,["ordinal","event","executionContextId"]) || !contexts.delete(event.executionContextId))return false;}
   else if(event.event==="created"){
    if(!ownData(event,["ordinal","event","executionContextId","uniqueId","frameId","isDefault"]) || !Number.isSafeInteger(event.executionContextId) || contexts.has(event.executionContextId) || ![event.uniqueId,event.frameId].every(technicalId) || typeof event.isDefault!=="boolean")return false;
    contexts.set(event.executionContextId,event);
   }else return false;
  }
  return journal.documents.every((document,index)=>{
   if(!ownData(document,["ordinal","requestId","frameId","loaderId","originSha256","documentGeneration"]) || document.ordinal!==index+1 || ![document.requestId,document.frameId,document.loaderId,document.documentGeneration].every(technicalId) || !digest(document.originSha256))return false;
   const prefix=contextId+":";if(!document.documentGeneration.startsWith(prefix))return false;const number=Number(mixedOwnedSlice(document.documentGeneration,prefix.length));
   return Number.isSafeInteger(number) && number>=1 && number<=journal.currentGeneration && document.documentGeneration===prefix+number;
  });
 }catch{return false;}
}function knownTeamDocumentCut(journal,document) {
	try {
		if(!knownTeamDocumentJournal(journal,document.contextId) || journal?.protocol!=="actual-cdp-document-journal-v1" || journal.contextId!==document.contextId || journal.installed!==true || journal.closed!==false || journal.errors!==0 || journal.overflow!==0 ||
			journal.currentGeneration!==document.documentGeneration || !Array.isArray(journal.documents) || !Array.isArray(journal.executionEvents) || journal.documents.length+journal.executionEvents.length>10000 ||
			journal.documentEventOrdinal!==journal.documents.length || journal.executionEventOrdinal!==journal.executionEvents.length || journal.documentEventOrdinal!==document.documentEventOrdinalAfter || journal.executionEventOrdinal!==document.executionEventOrdinalAfter)return false;
		mixedOwnedIndexWork(journal.executionEvents.length+journal.documents.length);
		const contexts=new Map();
		for(const [index,event]of journal.executionEvents.entries()) {
			if(event.ordinal!==index+1)return false;
			if(event.event==="cleared")contexts.clear();
			else if(event.event==="destroyed") {if(!contexts.delete(event.executionContextId))return false;}
			else if(event.event==="created") {
				if(!Number.isSafeInteger(event.executionContextId) || contexts.has(event.executionContextId) || ![event.uniqueId,event.frameId].every(technicalId) || typeof event.isDefault!=="boolean")return false;
				contexts.set(event.executionContextId,event);
			}else return false;
		}
		const defaults=mixedOwnedArray(contexts.size,()=>[...contexts.values()].filter(row=>row.isDefault && row.frameId===document.frameId),{bytesPerEntry:16});
		if(defaults.length!==1 || defaults[0].uniqueId!==document.executionContextUniqueId || defaults[0].executionContextId!==document.executionContextId)return false;
		const documents=mixedOwnedFilter(journal.documents,(row,index)=>row.ordinal===index+1 && row.requestId===document.documentRequestId && row.frameId===document.frameId && row.loaderId===document.loaderId && row.originSha256===document.originSha256 && row.documentGeneration===document.contextId+":"+document.documentGeneration);
		return documents.length===1 && journal.documents.every((row,index)=>row.ordinal===index+1 && [row.requestId,row.frameId,row.loaderId,row.documentGeneration].every(technicalId) && digest(row.originSha256));
	}catch{return false;}
}/** A cut is issued only from an already completed, stable read. It cannot authorize an earlier request. */
function replayOriginalTeamUIProducerCut({source,operator,acknowledgment,principal,workers,binding,documentJournal}) {
	try {
		const ack=acknowledgment,doc=ack?.document,controller=ack?.controller;
		if(!knownOriginalTeamSourceFacts(source) || !ownData(operator,["protocol","operatorFile","protocolSources","planSha256","executablePlanSteps","manualReplayHeader","pageRoutes"]) || !knownTeamPageRoutes(operator.pageRoutes) || operator.pageRoutes.originSha256!==doc?.originSha256 ||
            operator.protocol!=="closed-team-operator-source-v1" || !["run-baseline.mjs","settled-resources.mjs","mixed-load-probe.mjs"].includes(operator.operatorFile) || !digest(operator.planSha256) || operator.executablePlanSteps!==false || operator.manualReplayHeader!==teamReplayHeader ||
            !operator.protocolSources || ![operator.operatorFile,"browser-control-collector.mjs","team-temporary-value-authority.mjs","inert-date-range-request.mjs","journey-steps.mjs","trace-transport.mjs"].every(file=>digest(operator.protocolSources[file])) || !knownTemporaryValueObservation(binding?.temporaryValueObservation) ||
			binding.manifestVerified!==true || binding.browserVerified!==true || binding.compiledBuild!==source.binarySource || binding.compiledManifestSha256!==source.manifestSha256 || !knownOriginalTeamSourceConfiguration(binding.originalTeamSource,source.binarySource,source.manifestSha256) || binding.originalTeamSource===null ||
			ack?.protocol!=="native-environment-progress-readonly-v1" || ack.sourceSubsetExceeded===true || ack.timedOut!==false || ack.pendingOperations!==0 || ack.readErrors!==0 ||
			!Number.isSafeInteger(ack.checkpointOrdinal) || ack.checkpointOrdinal<1 || ack.checkpointOrdinal>10000 ||
            ![ack.startedAtMs,ack.finishedAtMs,ack.deadlineMs,ack.deadlineBudgetMs,ack.elapsedMs].every(Number.isFinite) || ack.startedAtMs>ack.finishedAtMs || ack.elapsedMs!==ack.finishedAtMs-ack.startedAtMs || ack.deadlineMs-ack.startedAtMs!==ack.deadlineBudgetMs || ack.deadlineBudgetMs<=0 || ack.deadlineBudgetMs>10000 || ack.finishedAtMs>ack.deadlineMs ||
			doc?.protocol!=="actual-cdp-document-acknowledgment-v1" || doc.actualDocumentIdentityStable!==true || ![doc.contextId,doc.frameId,doc.loaderId,doc.executionContextUniqueId,doc.documentRequestId].every(technicalId) ||
			!Number.isSafeInteger(doc.documentGeneration) || doc.documentGeneration<1 || !digest(doc.originSha256) ||
			mixedOwnedJSONString(doc.sourceJournal)!==mixedOwnedJSONString(documentJournal) || !knownTeamDocumentCut(documentJournal,doc) || documentJournal?.installed!==true || documentJournal.closed!==false || documentJournal.errors!==0 || documentJournal.overflow!==0 ||
			doc.executionEventOrdinalBefore!==doc.executionEventOrdinalAfter || doc.documentEventOrdinalBefore!==doc.documentEventOrdinalAfter ||
			!knownTeamPrincipalHistory(principal,ack) || principal?.protocol!=="actual-browser-cookie-boundaries-v1" || principal.contextId!==doc.contextId || principal.scopeClosed!==false || principal.before?.known!==true ||
			ack.principalRead?.known!==true || !sameJSON(ack.principalRead,principal.before) || principal.before.cookieCount!==1 || !digest(principal.before.sha256) ||
            !["originKnown","httpOnlyKnown","allHttpOnly","singleOwnedRootHttpOnlyCookie"].every(key=>principal.before.cookieAttributes?.[key]===true) || !digest(principal.before.cookieAttributes.singleCookieHeaderSha256) ||
			!["observedSetCookieResponses","unknownResponseHeaders","readErrors","pendingReads","observationErrors","overflow"].every(key=>principal[key]===0) ||
			workers?.protocol!=="owned-context-worker-target-metadata-v1" || workers.contextId!==doc.contextId || workers.contextJoinKnown!==true || workers.installed!==true || workers.scopeClosed!==false || workers.errors!==0 || workers.overflow!==0 ||
			!Array.isArray(workers.events) || workers.events.length<1 || workers.events.length>256 || workers.events.some(row=>!["page","service_worker"].includes(row.type) || row.urlKnown!==true || !digest(row.urlSha256) || (row.type==="service_worker" ? row.ownedWorkerScript!==true || row.originMatches!==true : row.originMatches!==true && row.urlSha256!==sha("about:blank"))) ||
			!sourcePublicKnown(ack.publicSourceRecheck,binding.nativePublicSources))return null;
		const expectedWorker=operator.pageRoutes.workerScriptSha256;
		const controllerRegime=originalTeamControllerRegime(controller,workers,expectedWorker,operator.pageRoutes.rootScopeSha256);if(!controllerRegime)return null;
		const facts=deepFreeze({protocol:"observed-team-ui-source-cut-v1",contextId:doc.contextId,originSha256:doc.originSha256,frameId:doc.frameId,loaderId:doc.loaderId,
			documentGeneration:doc.contextId+":"+doc.documentGeneration,executionContextUniqueId:doc.executionContextUniqueId,documentRequestId:doc.documentRequestId,
			checkpointOrdinal:ack.checkpointOrdinal,documentJournalSha256:sha(mixedOwnedJSONString(documentJournal)),principalSha256:principal.before.sha256,cookieHeaderSha256:principal.before.cookieAttributes.singleCookieHeaderSha256,workerJournalSha256:sha(mixedOwnedJSONString(workers)),
			controllerSha256:sha(mixedOwnedJSONString(controller)),controllerRegime,workerScriptSha256:expectedWorker,routeContractSha256:sha(mixedOwnedJSONString(operator.pageRoutes)),publicSourceSha256:sha(mixedOwnedJSONString(ack.publicSourceRecheck)),operatorSourceSha256:sha(mixedOwnedJSONString(operator)),operatorFile:operator.operatorFile});
		return facts;
	} catch { return null; }
}
export function createOriginalTeamUIProducerCut(input) {
	try {
		const qualification=input.qualification,operatorQualification=input.operatorQualification,operator=operatorQualifications.get(operatorQualification),source=qualifications.get(qualification);
		if(!source || operator?.qualification!==qualification)return null;
		const facts=replayOriginalTeamUIProducerCut({...input,source,operator:operator.facts});if(!facts)return null;
		const result=Object.freeze({protocol:"private-team-ui-source-cut-v1"});uiProducerCuts.set(result,{qualification,operatorQualification,facts,workers:input.workers});return result;
	} catch { return null; }
}
// One immutable fact graph per qualification; observers do not independently copy its route table.
export function originalTeamOperatorSourceFacts(qualification) {const held=operatorQualifications.get(qualification);return held?held.facts:null;}
export function originalTeamUIProducerCutFacts(cut) { const held=uiProducerCuts.get(cut);return held?structuredClone(held.facts):null; }
export function originalTeamUIProducerWorkerExtension(cut,workers) {
 try {const held=uiProducerCuts.get(cut);return Boolean(held && sha(mixedOwnedJSONString(held.workers))===held.facts.workerJournalSha256 && knownOriginalTeamWorkerExtension(held.workers,workers,held.facts.workerScriptSha256));}catch{return false;}
}
const sourceCaptureHandles=new WeakMap();
/** Actual callback order, not timestamps. Missing earlier cuts remain recorded missing. */
export function createTeamSourceCutJournal({contextId,reserve}) {
	if(!technicalId(contextId) || typeof reserve!=="function")throw Error("Known team source observation ownership is required.");
	const owner={},rows=[],occurrences=new Set(),issued=new WeakMap();let closed=false,errors=0,overflow=0,budgetKnown=true,retainedBytes=0;
	const append=(kind,id,cut,pageRoute=null)=>{
		if(closed || !technicalId(id) || !["issued","proxy-request","browser-request"].includes(kind) || occurrences.has(kind+":"+id) || pageRoute!==null && (kind!=="browser-request" || !knownTeamRequestRouteShape(pageRoute))){errors++;return null;}
		const charge=pageRoute===null?4096:8192;
		if(rows.length>=10000 || retainedBytes+charge>33554432){overflow++;return null;}
		let answer;try{answer=reserve(charge);}catch{errors++;budgetKnown=false;return null;}
		if(answer!==true){if(answer===false)overflow++;else{errors++;budgetKnown=false;}return null;}
		retainedBytes+=charge;
        const held=cut && uiProducerCuts.get(cut),prior=cut && issued.get(cut);
		if(held && held.facts.contextId!==contextId || kind==="issued" && (!held || prior)){errors++;return null;}
		const row=Object.freeze({ordinal:rows.length+1,kind,id,sourceCutOrdinal:kind==="issued"?rows.length+1:prior ?? null,sourceCutSha256:held?sha(mixedOwnedJSONString(held.facts)):null,pageRoute:pageRoute===null?null:Object.freeze({...pageRoute})});
		rows.push(row);occurrences.add(kind+":"+id);if(kind==="issued")issued.set(cut,row.ordinal);
		const handle=Object.freeze({protocol:"private-team-source-occurrence-v1"});sourceCaptureHandles.set(handle,{owner,contextId,known:()=>errors===0 && overflow===0 && budgetKnown && !closed,cut:prior || kind==="issued"?cut:null,facts:row});return handle;
	};
	return Object.freeze({issued(cut){return append("issued",String(uiProducerCuts.get(cut)?.facts.checkpointOrdinal ?? "unknown"),cut);},capture(kind,id,cut,pageRoute=null){return append(kind,id,cut,pageRoute);},
		close(){closed=true;},snapshot(){return {protocol:"team-source-occurrence-journal-v1",contextId,closed,errors,overflow,budgetKnown,retainedBytes:budgetKnown?retainedBytes:null,records:mixedOwnedRows(()=>rows,row=>({...row}))};}});
}/** Require the actual same cut at proxy acceptance and browser request observation, not a later read. */
export function bindOriginalTeamRequestValue(input) {
	try {
		const {qualification,store,handle,request,proxyCut,browserCut,dispatchJournal,wire}=input;
		const first=sourceCaptureHandles.get(proxyCut),second=sourceCaptureHandles.get(browserCut);
        const source=qualifications.get(qualification),stored=valueStores.get(store),record=stored?.recordFor(handle),cut=uiProducerCuts.get(first?.cut);
		if(!source || !record || record.released || !record.projection || !first || !second || !first.known() || !second.known() || first.owner!==second.owner || first.cut!==second.cut || first.facts.kind!=="proxy-request" || second.facts.kind!=="browser-request" || first.facts.id!==record.id || second.facts.id!==request?.requestId || cut?.qualification!==qualification || stored.contextId!==cut.facts.contextId ||
			!ownData(request,["contextId","proxyResponseId","requestId","traceId","method","fullUrlSha256","requestHeadersSha256","requestOriginSha256","documentGeneration","frameId","loaderId","actionHeaderSha256","requestBodySha256","encodedBytes","actualEOF","replayHeaderSha256","cookieHeaderSha256","pageRoute","headerEvidence"]) ||
			request.contextId!==stored.contextId || request.proxyResponseId!==record.id || request.method!=="POST" || !technicalId(request.requestId) || !/^[a-f0-9]{32}$/.test(request.traceId ?? "") ||
			![request.fullUrlSha256,request.requestHeadersSha256,request.requestOriginSha256,request.requestBodySha256].every(digest) || request.requestOriginSha256!==cut.facts.originSha256 ||
			request.documentGeneration!==cut.facts.documentGeneration || request.frameId!==cut.facts.frameId || request.loaderId!==cut.facts.loaderId || request.actionHeaderSha256!==source.actionHeaderSha256 ||
			request.cookieHeaderSha256!==cut.facts.cookieHeaderSha256 || request.actualEOF!==true || request.encodedBytes!==record.requestFacts.encodedBytes || request.requestBodySha256!==record.requestFacts.bodySha256 || !ownData(request.headerEvidence,["initial","extra"]) || !knownOriginalTeamHeaderJoin(request.headerEvidence.initial,request.headerEvidence.extra,wire,request.cookieHeaderSha256) || wire.requestHeadersSha256!==request.requestHeadersSha256 || !sameJSON(request.pageRoute,second.facts.pageRoute) ||
			!knownOriginalTeamRequestRoute(request.pageRoute,operatorQualifications.get(cut.operatorQualification)?.facts,{type:"Fetch",method:request.method,requestHeaderSnapshotKnown:true,requestOriginSha256:request.requestOriginSha256,fullUrlSha256:request.fullUrlSha256,headerFieldSha256:{"accept-language":sha(request.pageRoute?.locale ?? "")}}))return null;
		const occurrences={issuedOrdinal:first.facts.sourceCutOrdinal,proxy:first.facts,browser:second.facts};
        let producer={kind:"qualified-ui",sourceCut:cut.facts,manualDispatch:null,occurrences};
		if(request.replayHeaderSha256!==null) {
			if(!digest(request.replayHeaderSha256) || !dispatchJournals.has(dispatchJournal))return null;
			const manual=dispatchJournal.factsFor(record.id);
			if(!manual || manual.contextId!==stored.contextId || manual.nonceSha256!==request.replayHeaderSha256 || manual.browser.requestId!==request.requestId || manual.browser.frameId!==request.frameId || manual.browser.loaderId!==request.loaderId ||
				manual.urlSha256!==request.fullUrlSha256 || manual.bodySha256!==request.requestBodySha256 || manual.actionHeaderSha256!==request.actionHeaderSha256 || manual.traceId!==request.traceId)return null;
			producer={kind:"owned-manual-replay",sourceCut:cut.facts,manualDispatch:manual,occurrences};
		}
		const facts=deepFreeze({protocol:"original-team-request-value-authority-v1",source:{profileId:source.profileId,binarySource:source.binarySource,sourceFactsSha256:qualification.sourceFactsSha256},
			request:{...request},producer,requestFacts:record.requestFacts,typeFacts:record.typeFacts});
		const authority=Object.freeze({protocol:"private-original-team-request-authority-v1"});requestAuthorities.set(authority,{qualification,store,handle,record,facts,captures:[first,second]});return authority;
	} catch { return null; }
}
export function originalTeamRequestAuthorityFacts(authority) {const held=requestAuthorities.get(authority);return held?structuredClone(held.facts):null;}
const bodyInspections = new WeakMap();
/** Observer-only capability. It never grants source/request authority or resolves a T value. */
export function openOriginalTeamBodyInspection(input) {
	try {
		if (!(ownData(input, ["bodySha256", "decodedBytes"]) || ownData(input, ["bodySha256", "decodedBytes", "requestAuthority"])) || !digest(input.bodySha256) ||
			!Number.isSafeInteger(input.decodedBytes) || input.decodedBytes <= 0 || input.decodedBytes > 8 * 1024 * 1024) return null;
		const inspection = Object.freeze({ protocol: "private-original-team-body-inspection-v1" });
		bodyInspections.set(inspection, { bodySha256: input.bodySha256, decodedBytes: input.decodedBytes, closed: false,
			lookupAttempted: false, valueUsed: false, bindingSha256: null, qualification: null, resolved: null, store: null, consumer: null });
		const authority=requestAuthorities.get(input.requestAuthority);
		if(authority && authority.captures.every(capture=>capture.known()) && authority.record.projection && !authority.record.releaseAttempted) {
			const consumer=authority.store.beginInspection(authority.handle);
			if(consumer) {
				const receipt=deepFreeze({protocol:"original-team-temporary-value-binding-v1",requestAuthority:authority.facts,bodySha256:input.bodySha256,decodedBytes:input.decodedBytes,temporaryKeySha256:sha("$T0:0")});
				Object.assign(bodyInspections.get(inspection),{qualification:authority.qualification,store:authority.store,handle:authority.handle,captures:authority.captures,consumer,resolved:Object.freeze({value:authority.record.projection.value,receipt})});
			}
		}
		return inspection;
	} catch { return null; }
}
/** Missing source/request issuance, copied capabilities, and every token except exact T0:0 fail closed. */
export function resolveOriginalTeamTemporaryReference(inspection, token, boundary) {
	try {
		const held = inspection !== null && typeof inspection === "object" ? bodyInspections.get(inspection) : null;
		if (!held || held.closed || boundary?.action !== true || boundary.requestKind !== "action" ||
			boundary.bodySha256 !== held.bodySha256 || boundary.decodedBytes !== held.decodedBytes) return null;
		held.lookupAttempted = true;
		if (!isOriginalTeamSourceQualification(held.qualification) || !held.captures?.every(capture=>capture.known()) || token !== "$T0:0" || held.resolved === null) return null;
		const bindingSha256=sha(mixedOwnedJSONString(held.resolved.receipt));
        if(!valueStores.get(held.store)?.observeUse(held.handle,held.bodySha256,held.decodedBytes,bindingSha256))return null;
        held.valueUsed = true; held.bindingSha256 = bindingSha256;
		return held.resolved;
	} catch { return null; }
}
export function closeOriginalTeamBodyInspection(inspection) {
	const held = inspection !== null && typeof inspection === "object" ? bodyInspections.get(inspection) : null;
	if (!held || held.closed) return false;
	held.closed = true;
	const store=held.store,consumer=held.consumer;held.resolved=null;held.store=null;held.handle=null;held.captures=null;held.consumer=null;held.qualification=null;
	return store === null ? true : store.finishInspection(consumer);
}
/** Available only after this actual capability closes; contains no private value or token. */
export function originalTeamBodyObservation(inspection) {
	const held = inspection !== null && typeof inspection === "object" ? bodyInspections.get(inspection) : null;
	return held?.closed ? Object.freeze({ protocol: "original-team-body-value-observation-v1", bodySha256: held.bodySha256,
		decodedBytes: held.decodedBytes, lookupAttempted: held.lookupAttempted, valueUsed: held.valueUsed,
		bindingSha256: held.bindingSha256, closed: true }) : null;
}
const expectedOriginalSourceFacts = profile => ({protocol:"original-team-temporary-source-facts-v1",profileId:profile.id,phase:"baseline",binarySource:profile.binarySource,
	manifestSha256:profile.manifestSha256,buildRecordSha256:profile.buildRecordSha256,registrySha256:profile.registrySha256,actionHeaderSha256:profile.actionHeaderSha256,
	selectedActionMatches:1,concurrentRouterQueue:false,cachedNavigations:true,appFiles:profile.appFiles,frameworkFiles:profile.frameworkFiles});
const sameJSON=(left,right)=>mixedOwnedJSONString(left)===mixedOwnedJSONString(right);
function knownRequestAuthority(authority,boundary) {
	try {
		if(!ownData(authority,["protocol","source","request","producer","requestFacts","typeFacts"]) || authority.protocol!=="original-team-request-value-authority-v1" ||
			!ownData(authority.source,["profileId","binarySource","sourceFactsSha256"]) || !knownClosedDateRangeTypeFacts(authority.typeFacts))return false;
		const profile=originalTeamTemporaryProfiles.find(row=>row.id===authority.source.profileId),request=authority.request,producer=authority.producer,context=boundary.context,row=boundary.request;
		if(!profile || authority.source.binarySource!==profile.binarySource || authority.source.sourceFactsSha256!==sha(mixedOwnedJSONString(expectedOriginalSourceFacts(profile))) ||
			!request || request.contextId!==context?.contextId || request.method!=="POST" || request.actualEOF!==true || request.actionHeaderSha256!==profile.actionHeaderSha256 ||
			![request.proxyResponseId,request.requestId,request.documentGeneration,request.frameId,request.loaderId].every(technicalId) || !/^[a-f0-9]{32}$/.test(request.traceId ?? "") ||
			![request.fullUrlSha256,request.requestHeadersSha256,request.requestOriginSha256,request.requestBodySha256].every(digest) ||
			!Number.isSafeInteger(request.encodedBytes) || request.encodedBytes<1 || request.encodedBytes>16384 || request.replayHeaderSha256!==null && !digest(request.replayHeaderSha256) ||
			!row || !sameJSON(row.temporaryRequestAuthority,authority) || row.contextId!==request.contextId || row.requestHeaderSnapshotKnown!==true || row.method!==request.method || row.action!==true || row.requestKind!=="action" ||
			row.fullUrlSha256!==request.fullUrlSha256 || row.requestHeadersSha256!==request.requestHeadersSha256 || row.documentGeneration!==request.documentGeneration || row.traceId!==request.traceId || row.requestOriginSha256!==request.requestOriginSha256 ||
			!ownData(request.headerEvidence,["initial","extra"]) || !knownOriginalTeamHeaderJoin(request.headerEvidence.initial,request.headerEvidence.extra,row,request.cookieHeaderSha256) ||
			(row.id!==undefined ? row.requestId!==undefined || row.id!==request.proxyResponseId : row.requestHeadersKnown!==true || row.ambiguousRedirect!==false || row.type!=="Fetch" || !knownOriginalTeamHeaderJoin(row.initialHeaderIdentity,row.extraHeaderIdentity,row,request.cookieHeaderSha256) ||
             !["requestHeaderSnapshotKnown","requestHeadersSha256","headerFieldSha256"].every(key=>sameJSON(request.headerEvidence.initial[key],row.initialHeaderIdentity[key]) && sameJSON(request.headerEvidence.extra[key],row.extraHeaderIdentity[key])) || row.proxyResponseId!==request.proxyResponseId || row.requestId!==request.requestId || row.frameId!==request.frameId || row.loaderId!==request.loaderId) ||
			row.headerFieldSha256?.cookie!==request.cookieHeaderSha256 || row.headerFieldSha256?.["next-action"]!==profile.actionHeaderSha256 || row.headerFieldSha256?.[teamReplayHeader]!==request.replayHeaderSha256)return false;
		const actualEOF=row.requestBodyFacts;
        if(!ownData(actualEOF,["protocol","proxyResponseId","actualEOF","encodedBytes","bodySha256"]) || actualEOF.protocol!=="owned-proxy-request-eof-v1" || actualEOF.proxyResponseId!==request.proxyResponseId || actualEOF.actualEOF!==true || actualEOF.encodedBytes!==request.encodedBytes || actualEOF.bodySha256!==request.requestBodySha256)return false;
        const syntax=authority.requestFacts;
		if(!ownData(syntax,["protocol","sourceBound","requestEOFClaim","acceptanceClaim","encodedBytes","bodySha256","work","maxDepth","punctuation","known","duplicateKeys","inputConsumed","fieldCount","valueDescriptorSha256"]) ||
			syntax.protocol!=="inert-date-range-request-v1" || syntax.sourceBound!==false || syntax.requestEOFClaim!==false || syntax.acceptanceClaim!=="none" || syntax.known!==true || syntax.duplicateKeys!=="absent" || syntax.inputConsumed!==true || syntax.fieldCount!==5 ||
			syntax.encodedBytes!==request.encodedBytes || syntax.bodySha256!==request.requestBodySha256 || !digest(syntax.valueDescriptorSha256) || !Number.isSafeInteger(syntax.work) || syntax.work<1 || syntax.work>65536 || syntax.maxDepth!==2 || !Number.isSafeInteger(syntax.punctuation) || syntax.punctuation<1 || syntax.punctuation>32)return false;
		const binding=context.binding,environment=context.environment,readInfo=environment?.temporaryValueSourceReads,values=environment?.temporaryValues;
		if(context.protocol!=="qualified-known-extra-native-context-v1" || context.originSha256!==request.requestOriginSha256 || binding?.compiledBuild!==profile.binarySource || binding.compiledManifestSha256!==profile.manifestSha256 ||
			binding.browserVerified!==true || binding.manifestVerified!==true || !knownTemporaryValueObservation(binding.temporaryValueObservation) || !knownOriginalTeamSourceConfiguration(binding.originalTeamSource,profile.binarySource,profile.manifestSha256) || binding.originalTeamSource===null ||
			readInfo?.protocol!=="actual-team-source-read-journal-v1" || typeof readInfo.scopeClosed!=="boolean" || readInfo.scopeClosed!==context.principalEpoch?.scopeClosed || readInfo.pending!==0 || readInfo.errors!==0 || readInfo.overflow!==0 ||
			!Array.isArray(readInfo.records) || readInfo.records.length>10000 || !ownData(producer,["kind","sourceCut","manualDispatch","occurrences"]) || !["qualified-ui","owned-manual-replay"].includes(producer.kind))return false;
		const cut=producer.sourceCut,records=mixedOwnedFilter(readInfo.records,record=>record.checkpointOrdinal===cut?.checkpointOrdinal),occurrences=producer.occurrences,journal=values?.sourceCuts;
		if(journal?.protocol!=="team-source-occurrence-journal-v1" || journal.contextId!==request.contextId || journal.errors!==0 || journal.overflow!==0 || journal.budgetKnown!==true || journal.closed!==readInfo.scopeClosed ||
			!Array.isArray(journal.records) || journal.records.length>10000 || !ownData(occurrences,["issuedOrdinal","proxy","browser"]))return false;
		const occurrenceKeys=new Set();
        for(const [index,entry]of journal.records.entries()) {
			if(!ownData(entry,["ordinal","kind","id","sourceCutOrdinal","sourceCutSha256","pageRoute"]) || entry.ordinal!==index+1 || occurrenceKeys.has(entry.kind+":"+entry.id) || !["issued","proxy-request","browser-request"].includes(entry.kind) || !technicalId(entry.id) || entry.pageRoute!==null && (entry.kind!=="browser-request" || !knownTeamRequestRouteShape(entry.pageRoute)) ||
				entry.sourceCutSha256!==null && !digest(entry.sourceCutSha256) || entry.sourceCutOrdinal!==null && (!Number.isSafeInteger(entry.sourceCutOrdinal) || entry.sourceCutOrdinal<1 || entry.sourceCutOrdinal>entry.ordinal || journal.records[entry.sourceCutOrdinal-1]?.kind!=="issued" || journal.records[entry.sourceCutOrdinal-1].sourceCutSha256!==entry.sourceCutSha256) || entry.kind==="issued" && entry.sourceCutOrdinal!==entry.ordinal)return false;
            occurrenceKeys.add(entry.kind+":"+entry.id);
		}
		const issued=journal.records[occurrences.issuedOrdinal-1];
		if(issued?.kind!=="issued" || issued.id!==String(cut?.checkpointOrdinal) || issued.sourceCutSha256!==sha(mixedOwnedJSONString(cut)) ||
			![occurrences.proxy,occurrences.browser].every(entry=>sameJSON(journal.records[entry?.ordinal-1],entry) && entry.sourceCutOrdinal===issued.ordinal && entry.ordinal>issued.ordinal) ||
			occurrences.proxy.kind!=="proxy-request" || occurrences.proxy.id!==request.proxyResponseId || occurrences.browser.kind!=="browser-request" || occurrences.browser.id!==request.requestId || !sameJSON(occurrences.browser.pageRoute,request.pageRoute) ||
            !knownOriginalTeamRequestRoute(request.pageRoute,readInfo.operatorSource,{...row,type:row.id!==undefined?request.pageRoute?.resourceType:row.type}))return false;
		if(records.length!==1 || !sameJSON(records[0].issuedCut,cut) || readInfo.operatorSource?.operatorFile!==context.operatorFile || !sameJSON(readInfo.operatorSource.protocolSources,context.protocolSources))return false;
		const proof=records[0];
        if(!Number.isFinite(proof.eventObservedAtMs) || proof.observerDeadlineMs!==proof.eventObservedAtMs+10000 || proof.acknowledgment?.deadlineMs!==proof.observerDeadlineMs || proof.acknowledgment.startedAtMs<proof.eventObservedAtMs)return false;
        const recomputed=replayOriginalTeamUIProducerCut({source:expectedOriginalSourceFacts(profile),operator:readInfo.operatorSource,acknowledgment:proof.acknowledgment,
			principal:proof.principal,workers:proof.workers,binding,documentJournal:proof.acknowledgment?.document?.sourceJournal});
		if(!recomputed || !sameJSON(recomputed,cut) || cut.contextId!==request.contextId || cut.originSha256!==request.requestOriginSha256 || cut.frameId!==request.frameId || cut.loaderId!==request.loaderId || cut.documentGeneration!==request.documentGeneration || request.cookieHeaderSha256!==cut.cookieHeaderSha256)return false;
		const census=context.headerCensus,lifetime=context.headerLifetime;
		if(!validateProxyHeaderCensus(census,{contextId:request.contextId}) || !["unknownHeaders","setCookieResponses","setCookieLines","errors","duplicates","missing","late","overflow"].every(key=>census.counts[key]===0) ||
			lifetime?.protocol!=="owned-context-upstream-header-lifetime-v1" || lifetime.contextId!==request.contextId || lifetime.installation?.protocol!==lifetime.protocol ||
			lifetime.installation.originSha256!==request.requestOriginSha256 || lifetime.installation.acceptedRequestsAtInstall!==0 || !Array.isArray(lifetime.installation.allowedOriginSha256) || !lifetime.installation.allowedOriginSha256.includes(request.requestOriginSha256))return false;
		const prefix=context.headerPrefix,life=prefix?.lifecycle,headerRows=mixedOwnedFilter(census.requests,entry=>entry.requestId===request.proxyResponseId);
		if(headerRows.length!==1 || headerRows[0].observation!=="headers" || headerRows[0].setCookieLines!==0 || headerRows[0].setCookieSha256!==null ||
			!ownData(prefix,["protocol","census","lifecycle","prefixSha256"]) || prefix.protocol!=="owned-proxy-open-header-prefix-v1" || !sameJSON(prefix.census,census) ||
			!validateProxyHeaderLifecycle(life) || life.errors!==0 || life.overflow!==0 || life.upstreamRequests!==census.counts.accepted || life.requests.length!==census.requests.length ||
			life.proxyInstanceId!==lifetime.installation.proxyInstanceId || life.originSha256!==request.requestOriginSha256 || !sameJSON(life.allowedOriginSha256,lifetime.installation.allowedOriginSha256) ||
			prefix.prefixSha256!==sha(mixedOwnedJSONString({protocol:prefix.protocol,census:prefix.census,lifecycle:life})))return false;
		const lifecycleRows=mixedOwnedFilter(life.requests,entry=>entry.requestId===request.proxyResponseId);
		if(lifecycleRows.length!==1 || lifecycleRows[0].originSha256!==request.requestOriginSha256 || lifecycleRows[0].headersReceivedOrdinal===null || lifecycleRows[0].headersForwardedOrdinal===null ||
			census.requests.some(entry=>!life.requests.some(observed=>observed.requestId===entry.requestId)))return false;
		if(context.principalEpoch.scopeClosed) {
			const closure=lifetime.closure;
			if(census.closed!==true || life.closed!==true || lifecycleRows[0].upstreamClosedOrdinal===null || census.counts.pending!==0 || census.counts.terminalBeforeHeaders!==0 || census.counts.knownHeaders!==census.counts.accepted || closure?.serverClosed!==true || closure.acceptedRequests!==census.counts.accepted || closure.upstreamRequests!==census.counts.accepted || closure.closedUpstreams!==census.counts.accepted || closure.pendingUpstreams!==0)return false;
		}else {
			if(!validateProxyHeaderPrefix(prefix,{contextId:request.contextId}) || lifetime.closure!==null)return false;
		}
		const finalJournal=readInfo.documentJournal,pastJournal=proof.acknowledgment.document.sourceJournal,workers=environment.workerTargets,pastWorkers=proof.workers,principal=context.principalEpoch;
		if(!knownTeamDocumentJournal(finalJournal,request.contextId) || finalJournal?.contextId!==request.contextId || finalJournal.errors!==0 || finalJournal.overflow!==0 || !Array.isArray(finalJournal.documents) || !Array.isArray(finalJournal.executionEvents) ||
			!sameJSON(mixedOwnedSlice(finalJournal.documents,0,pastJournal.documents.length),pastJournal.documents) || !sameJSON(mixedOwnedSlice(finalJournal.executionEvents,0,pastJournal.executionEvents.length),pastJournal.executionEvents) ||
			!knownOriginalTeamWorkerExtension(pastWorkers,workers,cut.workerScriptSha256) ||
			principal?.before?.sha256!==cut.principalSha256 || !["observedSetCookieResponses","unknownResponseHeaders","readErrors","pendingReads","observationErrors","overflow"].every(key=>principal[key]===0) ||
			principal.scopeClosed && (principal.after?.known!==true || principal.after.sha256!==cut.principalSha256))return false;
		if(producer.kind==="qualified-ui") {if(request.replayHeaderSha256!==null || producer.manualDispatch!==null)return false;}
		else {
			const manual=producer.manualDispatch,journal=values?.manualDispatch,actual=mixedOwnedOptionalFilter(journal?.rows,item=>item.proxyId===request.proxyResponseId);
			if(manual?.protocol!=="observed-team-manual-dispatch-v1" || manual.contextId!==request.contextId || manual.proxyId!==request.proxyResponseId || manual.nonceSha256!==request.replayHeaderSha256 || manual.bodySha256!==request.requestBodySha256 || manual.traceId!==request.traceId ||
				manual.browser?.requestId!==request.requestId || manual.browser.frameId!==request.frameId || manual.browser.loaderId!==request.loaderId || manual.browser.documentGeneration!==request.documentGeneration ||
				manual.browser.initialReplaySha256!==request.replayHeaderSha256 || manual.browser.extraReplaySha256!==request.replayHeaderSha256 ||
				journal?.errors!==0 || journal.overflow!==0 || journal.unretainedArms!==0 || journal.budgetKnown!==true || !Array.isArray(actual) || actual.length!==1 || actual[0].nonceSha256!==request.replayHeaderSha256 ||
				!["ordinal","traceId","nonceSha256","urlSha256","actionHeaderSha256","encodedBytes","bodySha256","proxyId"].every(key=>actual[0][key]===manual[key]) || !sameJSON(actual[0].requestEOF,manual.requestEOF) || !sameJSON(actual[0].browser,manual.browser) || principal.scopeClosed && (journal.closed!==true || actual[0].returned!==true || actual[0].returnedError!==false || journal.pendingDispatches!==0))return false;
		}
		const store=values?.store,selected=mixedOwnedOptionalFilter(store?.rows,item=>item.id===request.proxyResponseId);
		return store?.protocol==="bounded-unqualified-team-values-v1" && store.contextId===request.contextId && store.sourceBound===false && store.acceptanceClaim==="none" && store.errors===0 && store.overflow===0 && store.unavailable===0 && store.budgetKnown===true && Array.isArray(selected) && selected.length===1 &&
			sameJSON(selected[0].requestFacts,syntax) && sameJSON(selected[0].typeFacts,authority.typeFacts) && (!principal.scopeClosed || store.closed===true && store.pendingConsumers===0 && selected[0].pendingConsumers===0 && selected[0].valueForgotten===true && selected[0].released===true && finalJournal.closed===true && finalJournal.installed===true && Number.isSafeInteger(finalJournal.currentGeneration) && finalJournal.currentGeneration>=pastJournal.currentGeneration && workers.scopeClosed===true && workers.contextJoinKnown===true && workers.installed===true);
	} catch { return false; }
}
/** Both live factual cuts and final replay retain the actual zero/nonzero body-use observation. Final closure gates remain separate. */
export function validateOriginalTeamTemporaryValues(section,boundary) {return mixedOwnedOperation(()=>{
	try {
		if(!ownData(section,["protocol","referenceCount","binding","obligations"]) || section.protocol!=="original-team-temporary-values-v1" || !digest(boundary?.bodySha256) ||
			!Number.isSafeInteger(boundary.decodedBytes) || boundary.decodedBytes<1 || boundary.decodedBytes>8388608 || !Number.isSafeInteger(section.referenceCount) || section.referenceCount<0 || section.referenceCount>100000 || !Array.isArray(section.obligations) || section.obligations.length>16)return false;
		const roles=new Set();let count=0;
		for(const obligation of section.obligations) {
			if(!ownData(obligation,["role","count"]) || typeof obligation.role!=="string" || obligation.role!=="required" || roles.has(obligation.role) || !Number.isSafeInteger(obligation.count) || obligation.count<1 || obligation.count>100000)return false;
			roles.add(obligation.role);count+=obligation.count;
		}
		if(count!==section.referenceCount)return false;
		const observed=boundary.request?.temporaryValueObservation;
		if(boundary.request!==undefined && (!ownData(observed,["protocol","bodySha256","decodedBytes","lookupAttempted","valueUsed","bindingSha256","closed"]) || observed.protocol!=="original-team-body-value-observation-v1" || observed.bodySha256!==boundary.bodySha256 || observed.decodedBytes!==boundary.decodedBytes || observed.closed!==true))return false;
		if(section.binding===null)return section.referenceCount===0 && section.obligations.length===0 && (boundary.request===undefined || observed.lookupAttempted===false && observed.valueUsed===false && observed.bindingSha256===null);
		const receipt=section.binding;
		return ownData(receipt,["protocol","requestAuthority","bodySha256","decodedBytes","temporaryKeySha256"]) && receipt.protocol==="original-team-temporary-value-binding-v1" &&
			receipt.bodySha256===boundary.bodySha256 && receipt.decodedBytes===boundary.decodedBytes && receipt.temporaryKeySha256===sha("$T0:0") &&
			(boundary.request===undefined ? receipt.requestAuthority?.protocol==="original-team-request-value-authority-v1" && knownClosedDateRangeTypeFacts(receipt.requestAuthority.typeFacts) : observed?.lookupAttempted===true && observed.valueUsed===true && observed.bindingSha256===sha(mixedOwnedJSONString(receipt)) && knownRequestAuthority(receipt.requestAuthority,boundary));
	} catch { return false; }
});}
/** Actual dispatch/HTTP/CDP identity observations only; never source or value authority by themselves. */
export function createTeamReplayDispatchJournal({ contextId, origin, reserve, release }) {
	let target;
	try { target = new URL(origin); } catch {}
	if (!target || target.origin !== origin || target.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.username || target.password ||
		typeof contextId !== "string" || !/^[A-Za-z0-9:_.-]{1,256}$/.test(contextId) || typeof reserve !== "function" || typeof release !== "function")
		throw Error("Known owned team replay observation is required.");
	const owner = {}, rows = [], nonces = new Map(), proxies = new Map();
	let closed = false, errors = 0, overflow = 0, unretainedArms = 0, retained = 0, budgetKnown = true;
	const rowFor = handle => { const held = handle !== null && typeof handle === "object" ? dispatchHandles.get(handle) : null; return held?.owner === owner ? held.row : null; };
	const safeRow = row => ({ ordinal: row.ordinal, traceId: row.traceId, nonceSha256: row.nonceSha256, urlSha256: row.urlSha256, actionHeaderSha256: row.actionHeaderSha256,
		encodedBytes: row.encodedBytes, bodySha256: row.bodySha256, proxyId: row.proxyId, requestEOF: row.requestEOF, browser: row.browser, returned: row.returned, returnedError: row.returnedError });
	const api = Object.freeze({
		arm(input = {}) {
			try {
				const { traceId, action, body, url } = input, requestURL = typeof url === "string" && url.length <= 4096 ? new URL(url) : null;
				const deadlineField=!utilTypes.isProxy(input)?Object.getOwnPropertyDescriptor(input,"observerDeadlineMs"):null;
				const observerDeadlineMs=deadlineField && Object.hasOwn(deadlineField,"value") && Number.isFinite(deadlineField.value)?deadlineField.value:null;
				if (closed || !budgetKnown || !/^[a-f0-9]{32}$/.test(traceId ?? "") || typeof action !== "string" || !/^[a-f0-9]{40,64}$/.test(action) ||
					typeof body !== "string" || body.length > 16384 || Buffer.byteLength(body) > 16384 || requestURL?.origin !== origin || requestURL.username || requestURL.password) throw Error();
				if (rows.length >= 10000 || retained + 18432 > 32 * 1024 * 1024) { overflow++; unretainedArms++; return null; }
				let answer;
				try { answer = reserve(18432); } catch { errors++; budgetKnown = false; unretainedArms++; return null; }
				if (answer !== true) { if (answer === false) overflow++; else { errors++; budgetKnown = false; } unretainedArms++; return null; }
				retained += 18432;
				const nonce = randomBytes(16).toString("hex");
				const row = { ordinal: rows.length + 1, traceId, nonceSha256: sha(nonce), urlSha256: sha(requestURL.href), actionHeaderSha256: sha(action), encodedBytes: Buffer.byteLength(body), bodySha256: sha(body),
					proxyId: null, requestEOF: null, browser: null, returned: false, returnedError: null,observerDeadlineMs };
				try { release(16384); retained -= 16384; } catch { errors++; budgetKnown = false; unretainedArms++; return null; }
				if (nonces.has(nonce)) { errors++; unretainedArms++; return null; }
				const handle = Object.freeze({ protocol: "private-team-manual-dispatch-v1", contextId, ordinal: row.ordinal });
				rows.push(row); nonces.set(nonce, row); dispatchHandles.set(handle, { owner, row, nonce });
				return handle;
			} catch { errors++; unretainedArms++; return null; }
		},
		headers(handle) {
			const held = handle !== null && typeof handle === "object" ? dispatchHandles.get(handle) : null;
			if (closed || held?.owner !== owner || held.row.returned) { errors++; return null; }
			return Object.freeze({ [teamReplayHeader]: held.nonce });
		},
		proxyRequest({ id, traceId, method, url, action, nonce }) {
			const row = typeof nonce === "string" && /^[a-f0-9]{32}$/.test(nonce) ? nonces.get(nonce) : null;
			if (closed || !budgetKnown || !row || row.proxyId !== null || proxies.has(id) || typeof id !== "string" || !/^[a-f0-9]{32}\.[1-9][0-9]{0,15}$/.test(id) ||
				traceId !== row.traceId || method !== "POST" || typeof url !== "string" || url.length > 4096 || sha(url) !== row.urlSha256 || typeof action !== "string" || sha(action) !== row.actionHeaderSha256) { errors++; return false; }
			row.proxyId = id; proxies.set(id, row); return true;
		},
		requestEOF(id, facts) {
			const row = proxies.get(id);
			if (closed || !row || row.requestEOF !== null || facts?.encodedBytes !== row.encodedBytes || facts?.bodySha256 !== row.bodySha256) { errors++; return false; }
			row.requestEOF = Object.freeze({ encodedBytes: facts.encodedBytes, bodySha256: facts.bodySha256, actualEOF: true }); return true;
		},
		browserRequest(facts) {
			const row = proxies.get(facts?.proxyId);
			if (closed || !row || facts.contextId !== contextId || typeof facts.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/.test(facts.requestId) || facts.method !== "POST" || facts.traceId !== row.traceId ||
				facts.urlSha256 !== row.urlSha256 || facts.actionHeaderSha256 !== row.actionHeaderSha256 || facts.initialHeadersKnown !== true || facts.extraHeadersKnown !== true ||
				facts.initialReplaySha256 !== row.nonceSha256 || facts.extraReplaySha256 !== row.nonceSha256 ||
				![facts.frameId, facts.loaderId, facts.documentGeneration].every(value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value))) { errors++; return false; }
			const browser = Object.freeze({ requestId: facts.requestId, frameId: facts.frameId, loaderId: facts.loaderId, documentGeneration: facts.documentGeneration,
				initialReplaySha256: facts.initialReplaySha256, extraReplaySha256: facts.extraReplaySha256 });
			if (row.browser !== null && mixedOwnedJSONString(row.browser) !== mixedOwnedJSONString(browser)) { errors++; return false; }
			row.browser = browser; return true;
		},
		finished(handle, { error }) {
			const row = rowFor(handle);
			if (!row || row.returned || typeof error !== "boolean") { errors++; return false; }
			row.returned = true; row.returnedError = error; return true;
		},
		factsFor(id) {
			const row = proxies.get(id);
			return row?.requestEOF && row.browser ? deepFreeze({ protocol: "observed-team-manual-dispatch-v1", contextId, sourceBound: false, ...safeRow(row) }) : null;
		},
		inspectionDeadline(id){const row=proxies.get(id);return !closed && row?row.observerDeadlineMs:null;},
		close() { if (closed) return; closed = true; if (rows.some(row => !row.returned)) errors++; },
		snapshot() { return { protocol: "team-replay-dispatch-observations-v1", contextId, sourceBound: false, acceptanceClaim: "none", closed, errors, overflow, unretainedArms, budgetKnown,
			retainedBytes: budgetKnown ? retained : null, pendingDispatches: mixedOwnedFilter(rows,row => !row.returned).length, rows: mixedOwnedArray(rows.length,()=>mixedOwnedMap(rows,row => deepFreeze(structuredClone(safeRow(row)))),{bytesPerEntry:8192,records:rows.length}) }; },
	});
	dispatchJournals.set(api, { owner, contextId, proxies });
	return api;
}

async function readSource(path) {
	const handle = await open(path, "r");
	try {
		const before = await handle.stat({ bigint: true });
		if (!before.isFile() || before.size > 4194304n) throw Error();
		const bytes = Buffer.alloc(Number(before.size));
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
			if (!bytesRead) throw Error();
			offset += bytesRead;
		}
		const after = await handle.stat({ bigint: true });
		if (["dev", "ino", "size", "mtimeNs"].some(key => before[key] !== after[key])) throw Error();
		return bytes;
	} finally { await handle.close(); }
}
const json = bytes => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { throw Error(); } };
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
export function originalTeamSourceFileFacts(bytes) {
	try {
		if (!Buffer.isBuffer(bytes) || bytes.length > 4194304 || bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) return null;
		const canonical = Buffer.from(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\r\n/g, "\n"));
		return Object.freeze({ gitBlob: gitBlob(canonical), canonicalLfSha256: sha(canonical) });
	} catch { return null; }
}

/** Actual bounded file reads are the only live source issuer; public receipt copies cannot qualify. */
export async function readOriginalTeamSourceQualification(input) {
	try {
		if (!ownData(input, ["profileId", "phase", "compiledManifestPath", "buildRecordPath"])) throw Error();
		const { profileId, phase, compiledManifestPath, buildRecordPath } = input;
		const profile = originalTeamTemporaryProfiles.find(value => value.id === profileId);
		if (!profile || phase !== "baseline" || typeof compiledManifestPath !== "string" || typeof buildRecordPath !== "string" ||
			compiledManifestPath.length > 4096 || buildRecordPath.length > 4096 || basename(compiledManifestPath) !== "required-server-files.json") throw Error();
		const appRoot = dirname(dirname(resolve(compiledManifestPath))), sourceRoot = resolve(appRoot, "../..");
		if (basename(appRoot) !== "webapp" || basename(dirname(appRoot)) !== "apps") throw Error();
		const manifestBytes = await readSource(compiledManifestPath), recordBytes = await readSource(buildRecordPath);
		if (sha(manifestBytes) !== profile.manifestSha256 || sha(recordBytes) !== profile.buildRecordSha256) throw Error();
		const manifest = json(manifestBytes), record = json(recordBytes);
		if (manifest.config?.deploymentId !== profile.binarySource || manifest.config?.experimental?.concurrentRouterQueue !== false ||
			manifest.config?.experimental?.cachedNavigations !== true || record.source !== profile.binarySource || record.ci !== true || record.exitCode !== 0 || record.workers !== 2) throw Error();
		const registryBytes = await readSource(join(dirname(compiledManifestPath), "server/server-reference-manifest.json"));
		if (sha(registryBytes) !== profile.registrySha256) throw Error();
		const registry = json(registryBytes), actions = Object.entries(registry.node ?? {}).filter(([, value]) => value.exportedName === "getTeamPerformanceData");
		if (actions.length !== 1 || sha(actions[0][0]) !== profile.actionHeaderSha256 || actions[0][1].filename !== "apps/webapp/src/app/[locale]/(app)/analytics/actions.ts" ||
			mixedOwnedJSONString(Object.keys(actions[0][1].workers).sort()) !== mixedOwnedJSONString(["app/[locale]/(app)/analytics/page", "app/[locale]/(app)/analytics/team-performance/page"])) throw Error();
		const appFiles = [];
		for (const pin of profile.appFiles) {
			const file = originalTeamSourceFileFacts(await readSource(join(sourceRoot, pin.path)));
			if (!file) throw Error();
			appFiles.push({ path: pin.path, ...file });
		}
		const require = createRequire(join(appRoot, "package.json")), frameworkFiles = [];
		for (const pin of profile.frameworkFiles) {
			const bytes = await readSource(require.resolve(pin.path));
			frameworkFiles.push({ path: pin.path, bytes: bytes.length, sha256: sha(bytes) });
		}
		const facts = deepFreeze({ protocol: "original-team-temporary-source-facts-v1", profileId, phase,
			binarySource: profile.binarySource, manifestSha256: sha(manifestBytes), buildRecordSha256: sha(recordBytes), registrySha256: sha(registryBytes), actionHeaderSha256: sha(actions[0][0]),
			selectedActionMatches: actions.length, concurrentRouterQueue: manifest.config.experimental.concurrentRouterQueue, cachedNavigations: manifest.config.experimental.cachedNavigations, appFiles, frameworkFiles });
		if (!knownOriginalTeamSourceFacts(facts)) throw Error();
		const qualification = Object.freeze({ protocol: "private-original-team-source-v1", profileId, sourceFactsSha256: sha(mixedOwnedJSONString(facts)) });
		qualifications.set(qualification, facts);
		return qualification;
	} catch { throw Error("Original team temporary source qualification unavailable."); }
}

/** Mandatory independent kernel latch and observer census; deleting both body lists cannot erase a real private use. */
export function validateOriginalTeamBodyUseCoverage(context,bodies) {return mixedOwnedOperation(()=>{
 try {
  if(!Array.isArray(bodies) || bodies.length>10000)return false;
  if(context===undefined || context===null)return bodies.length===0;
  if(!knownTemporaryValueObservation(context.binding?.temporaryValueObservation))return false;
  const values=context.environment?.temporaryValues,store=values?.store,census=values?.bodyUses;
  if(store?.protocol!=="bounded-unqualified-team-values-v1" || store.contextId!==context.contextId || store.errors!==0 || store.overflow!==0 || store.unavailable!==0 || store.budgetKnown!==true ||
   store.usage?.protocol!=="actual-private-value-use-census-v1" || store.usage.contextId!==context.contextId || !Number.isSafeInteger(store.usage.observed) || store.usage.observed<0 || store.usage.observed>10000 ||
   !Array.isArray(store.rows) || store.rows.length>10000 || census?.protocol!=="actual-body-value-observations-v1" || census.contextId!==context.contextId || !Number.isSafeInteger(census.observed) || census.observed<0 || census.observed>10000 || !Array.isArray(census.records) || census.records.length!==census.observed)return false;
  const uses=new Map();
  for(const row of store.rows){
   if(typeof row.everUsed!=="boolean" || !Array.isArray(row.usedBodies) || row.usedBodies.length>10000 || row.everUsed!==(row.usedBodies.length>0))return false;
   for(const use of row.usedBodies){
    if(!mixedOwnedLazyValue(()=>({id:row.id,use}),()=>{
     const key=row.id+":"+use.bodySha256;if(uses.has(key) || !ownData(use,["bodySha256","decodedBytes","bindingSha256"]) || !digest(use.bodySha256) || !digest(use.bindingSha256) || !Number.isSafeInteger(use.decodedBytes) || use.decodedBytes<1 || use.decodedBytes>8388608)return false;
     uses.set(key,{proxyResponseId:row.id,...use});return true;
    },{copies:4,extraBytes:2048,records:1}))return false;
   }
  }
  if(uses.size!==store.usage.observed || uses.size!==census.observed)return false;
  const seen=new Set();
  for(const use of census.records){
   if(!mixedOwnedLazyValue(()=>use,()=>{
    const key=use.proxyResponseId+":"+use.bodySha256;
    if(seen.has(key) || !sameJSON(uses.get(key),use) || !bodies.some(entry=>(entry.row.id ?? entry.row.proxyResponseId)===use.proxyResponseId && entry.row.bodyProof?.bodySha256===use.bodySha256 && entry.row.temporaryValueObservation?.bindingSha256===use.bindingSha256))return false;
    seen.add(key);return true;
   },{copies:4,extraBytes:2048,records:0}))return false;
  }
  return bodies.every(entry=>mixedOwnedLazyValue(()=>({id:entry.row.id ?? entry.row.proxyResponseId,bodySha256:entry.row.bodyProof?.bodySha256}),()=>uses.has((entry.row.id ?? entry.row.proxyResponseId)+":"+entry.row.bodyProof?.bodySha256),{copies:4,extraBytes:2048,records:0}));
 }catch{return false;}
});}
import {mixedOwnedOptionalFilter,mixedOwnedLazyValue,mixedOwnedIndexWork,mixedOwnedMap,mixedOwnedSlice,mixedOwnedFilter,mixedOwnedOperation,mixedOwnedJSONString,mixedOwnedHashInput,mixedOwnedClone as structuredClone,mixedOwnedRows,mixedOwnedArray} from "./mixed-technical-gzip.mjs";

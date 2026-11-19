import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// This verifier reads evidence and optional declared source paths. It never runs
// an archived command, imports a payload, writes a file, or contacts a service.
const archive = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(archive, "../../../../..");
const args = process.argv.slice(2);
const currentSource = args.length === 1 && args[0] === "--current-source";
const frozenHead = "bc4010825c1fd94d634b7f4774b6f895bfac26f4";
const frozenAppTree = "138aab92cde099756c13347827a90112763def68";
const publicationHead = "d6a8863ddf6c9450848a85f88411825101ae13d6";
const publicationAppTree = "f3666bb7c8ff4b752eb316a78d02cfaeb895e51f";
const expectedSeal = "f4e3dceb9db72c056d79e19d9143bd56293ae086f3f957ae5d526532c799bc3c";
const expectedDrift = [
  "apps/webapp/src/app/[locale]/(app)/settings/enterprise/api-keys/use-developer-server-snapshot.ts",
  "apps/webapp/src/components/webhooks/webhooks-server-arrival.test.tsx",
];
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const readJSON = (name) => JSON.parse(fs.readFileSync(path.join(archive, name), "utf8"));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = /^[a-f0-9]{64}$/;
const objectId = /^[a-f0-9]{40}$/;
const safeSourcePath = (name) =>
  typeof name === "string" &&
  name.startsWith("apps/webapp/") &&
  !name.includes("\\") &&
  !name.split("/").some((part) => part === ".." || part === "." || part === "");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function checkPNG(bytes, name) {
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `PNG signature: ${name}`);
  let offset = 8;
  let header;
  let ended = false;
  const imageData = [];
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length && !ended, `PNG chunk bounds: ${name}`);
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    assert(end <= bytes.length, `PNG chunk length: ${name}`);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    assert(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), `PNG CRC: ${name}`);
    if (!header) {
      assert(type === "IHDR" && length === 13, `PNG IHDR: ${name}`);
      header = {
        path: name,
        width: bytes.readUInt32BE(offset + 8),
        height: bytes.readUInt32BE(offset + 12),
        bitDepth: bytes[offset + 16],
        colorType: bytes[offset + 17],
        compression: bytes[offset + 18],
        filter: bytes[offset + 19],
        interlace: bytes[offset + 20],
      };
      assert(header.width > 0 && header.height > 0 && header.width <= 20000 && header.height <= 20000, `PNG dimensions: ${name}`);
      assert(header.bitDepth === 8 && [2, 6].includes(header.colorType), `PNG supported capture format: ${name}`);
      assert(header.compression === 0 && header.filter === 0 && header.interlace === 0, `PNG capture encoding: ${name}`);
    } else assert(type !== "IHDR", `PNG duplicate IHDR: ${name}`);
    if (type === "IDAT") imageData.push(bytes.subarray(offset + 8, end - 4));
    if (type === "IEND") {
      assert(length === 0, `PNG IEND: ${name}`);
      ended = true;
    }
    offset = end;
  }
  assert(header && ended && imageData.length > 0, `PNG completeness: ${name}`);
  const rowBytes = header.width * (header.colorType === 6 ? 4 : 3);
  const scanlines = zlib.inflateSync(Buffer.concat(imageData), { maxOutputLength: (rowBytes + 1) * header.height });
  assert(scanlines.length === (rowBytes + 1) * header.height, `PNG scanline count: ${name}`);
  for (let row = 0; row < header.height; row++) assert(scanlines[row * (rowBytes + 1)] <= 4, `PNG row filter: ${name}`);
  return header;
}

try {
  assert(args.length === 0 || currentSource, "Usage: node verify-evidence.mjs [--current-source]");
  assert(fs.readFileSync(path.join(archive, ".gitattributes"), "utf8") === "* text eol=lf\nruntime/** -text\n", "Archive-local exact-byte attributes and LF metadata");
  const index = readJSON("payload-index.json");
  assert(index.schema === 1 && index.count === 29 && index.bytes === 1139397, "Payload index totals");
  assert(equal(index.types, { json: 23, png: 5, markdown: 1 }), "Payload type totals");
  assert(Array.isArray(index.payloads) && index.payloads.length === 29, "Payload index records");
  const seen = new Set();
  const payloadJSON = new Map();
  const pngs = [];
  let bytesTotal = 0;
  const types = { json: 0, png: 0, markdown: 0 };
  for (const p of index.payloads) {
    assert(/^runtime\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.path) && !seen.has(p.path), "Payload path schema/uniqueness");
    assert(Number.isSafeInteger(p.bytes) && p.bytes > 0 && digest.test(p.sha256), "Payload metadata schema");
    assert(!["runtime/before.json", "runtime/after.json"].includes(p.path), "Excluded inventory was indexed");
    seen.add(p.path);
    const bytes = fs.readFileSync(path.join(archive, p.path));
    assert(bytes.length === p.bytes && sha(bytes) === p.sha256, `Payload size/hash: ${p.path}`);
    bytesTotal += bytes.length;
    if (p.path.endsWith(".json")) {
      payloadJSON.set(p.path, JSON.parse(bytes.toString("utf8")));
      types.json++;
    } else if (p.path.endsWith(".png")) {
      pngs.push(checkPNG(bytes, p.path));
      types.png++;
    } else {
      assert(p.path === "runtime/README.md", "Unexpected payload extension");
      types.markdown++;
    }
  }
  const files = fs.readdirSync(path.join(archive, "runtime")).map((name) => `runtime/${name}`).sort();
  assert(equal(files, [...seen].sort()), "Runtime directory must contain exactly the indexed payloads");
  assert(bytesTotal === index.bytes && equal(types, index.types), "Parsed payload totals");
  const seal = sha(Buffer.from(index.payloads.map((p) => `${p.path}\0${p.bytes}\0${p.sha256}\n`).sort().join("")));
  assert(seal === expectedSeal && index.seal.algorithm === "sha256" && index.seal.sha256 === seal, "Exact payload seal");

  const receipt = readJSON("input-receipt.json");
  assert(receipt.schema === 1 && receipt.inputAllowlist.sha256 === "9855d09fb96212b64131ce08cef6f99335d38e1bb801279d857bb95ad2b9cc60", "Input allowlist receipt");
  assert(equal(receipt.inputDeclared, { payloads: 31, bytes: 13046953, json: 25, png: 5, markdown: 1 }), "Input declared totals");
  assert(equal(receipt.published, { payloads: 29, bytes: 1139397, json: 23, png: 5, markdown: 1 }), "Published receipt totals");
  assert(receipt.excludedBytes === 11907556 && receipt.excludedInventories.length === 2, "Excluded receipt totals");
  assert(equal(receipt.excludedInventories.map(({ path: name, bytes, sha256 }) => ({ path: name, bytes, sha256 })), ["before.json", "after.json"].map((name) => ({ path: name, bytes: 5953778, sha256: "3832ac0892a33acfab21e4c312867e19563341b19b49969b422f78a1dd514ea0" }))), "Hash-only inventory provenance");

  const source = readJSON("source-pins.json");
  assert(source.schema === 1 && source.recordsBeforeReconciliation === 56 && source.uniquePins === 56 && source.duplicateRecords === 0, "Source pin totals");
  assert(equal(source.configurationPins, []) && typeof source.configurationContentVerification === "string", "No configuration-content verification");
  assert(equal(source.derivation, [{ path: "runtime/1839-acceptance.json", records: 29 }, { path: "runtime/1744-acceptance.json", records: 27 }]), "Source derivation declarations");
  const reconciled = new Map();
  for (const issue of [1839, 1744]) {
    const a = payloadJSON.get(`runtime/${issue}-acceptance.json`);
    assert(a.schema === 1 && a.issue === issue && a.head === frozenHead && a.appTree === frozenAppTree, "Acceptance identity");
    assert(objectId.test(a.tree) && a.verifiedCommit === null && a.readiness === null, "Acceptance null readiness");
    assert(a.sourcePins.length === (issue === 1839 ? 29 : 27), "Acceptance pin count");
    const runtime = a.actualRuntimeAssertions;
    const expected = issue === 1839 ? 20 : 32;
    assert(runtime.total === expected && runtime.passed === expected && runtime.failed === 0 && runtime.assertions.length === expected && runtime.assertions.every((p) => p.passed === true), "Listed actual assertion counts");
    assert(a.freshUnitCases === 0 && a.freshPostgresSuiteCases === 0, "No fresh suite additions");
    for (const p of a.sourcePins) {
      assert(safeSourcePath(p.path) && digest.test(p.sha256), "Acceptance source pin schema");
      const prior = reconciled.get(p.path);
      if (prior) {
        assert(prior.sha256 === p.sha256, "Conflicting source pin");
        prior.sourceIssues.push(issue);
      } else reconciled.set(p.path, { path: p.path, sha256: p.sha256, sourceIssues: [issue] });
    }
  }
  const derived = [...reconciled.values()].sort((a, b) => a.path.localeCompare(b.path, "en"));
  assert(derived.length === 56 && equal(source.sourcePins, derived), "Exact reconciled source pins");
  for (const p of source.sourcePins) assert(safeSourcePath(p.path) && digest.test(p.sha256) && p.sourceIssues.every((n) => [1839, 1744].includes(n)), "Thin source pin schema");
  assert(source.actualRuntime.head === frozenHead && source.actualRuntime.appTree === frozenAppTree && source.actualRuntime.verifiedCommit === null && source.actualRuntime.readiness === null, "Historical runtime boundary");
  assert(equal(source.actualRuntime, receipt.runtimeIdentity), "Receipt/source runtime boundary parity");
  assert(equal(source.publicationBoundary, { head: publicationHead, appTree: publicationAppTree, runtimeWasExecutedHere: false, wholeCurrentAppVerified: false, verifiedCommit: null, readiness: null }), "Publication boundary");
  assert(source.fullAppTreeDrift.expected === true && equal(source.fullAppTreeDrift.paths, expectedDrift) && expectedDrift.every((p) => !reconciled.has(p)), "Legitimate declared full-app-tree drift");
  const result = { status: "PASS_BOUNDED_EVIDENCE", mode: currentSource ? "current-source" : "archive", payloads: 29, payloadBytes: bytesTotal, jsonParsed: types.json, pngStructuresChecked: pngs, payloadSeal: seal, excludedInventoriesHashOnly: 2, sourcePinsSchemaChecked: derived.length, configurationPins: 0, configurationContentVerified: false, actualRuntimeHead: frozenHead, actualRuntimeAppTree: frozenAppTree, runtimeRerun: false, wholeCurrentAppAccepted: false, verifiedCommit: null, readiness: null };
  if (currentSource) {
    for (const p of derived) assert(sha(fs.readFileSync(path.join(repo, p.path))) === p.sha256, `Current declared source hash: ${p.path}`);
    const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    const currentHead = git(["rev-parse", "HEAD"]);
    const currentAppTree = git(["rev-parse", "HEAD:apps/webapp"]);
    const drift = git(["diff", "--name-only", frozenHead, "HEAD", "--", "apps/webapp"]).split(/\r?\n/).filter(Boolean);
    assert(objectId.test(currentHead) && objectId.test(currentAppTree), "Current Git object identity");
    assert(drift.every((name) => !reconciled.has(name)), "Committed drift intersects a declared source pin");
    result.currentSource = { matchedPins: derived.length, currentHead, currentAppTree, declaredPublicationAppTreeMatch: currentAppTree === publicationAppTree, committedFullAppDrift: drift, interpretation: "Only declared source bytes are verified. Historical runtime was not rerun here. Full-app-tree drift outside these pins is not whole-app acceptance. No configuration content was checked." };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`FAIL_BOUNDED_EVIDENCE: ${error.message}`);
  process.exitCode = 1;
}

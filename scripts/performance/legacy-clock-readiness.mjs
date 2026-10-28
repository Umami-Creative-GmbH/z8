/** One reviewed legacy UI closure. This module returns source facts, never a caller capability. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) =>
	typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const source = (value) =>
	typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export const legacyClockReadinessProtocol =
	"source-qualified-legacy-header-readiness-v1";
export const reviewedLegacyClockFiles = Object.freeze(
	[
		{
			file: "apps/webapp/src/components/site-header.tsx",
			canonicalSha256:
				"332bf59fb9f851dd487e776c2df5373fb1366538b7f2e420541ba6da82e9111a",
			gitBlob: "6939569b9ea80f9b2d7d20eebd3ede865b094593",
		},
		{
			file: "apps/webapp/src/components/time-tracking/time-clock-popover.tsx",
			canonicalSha256:
				"42548ee6016b3a37fc89dc0155dd3f2e1c3ca16abb451a39d0c70cf5b0bd482c",
			gitBlob: "8d0a1fb6c51233862ef6ed16bd68edcf539e71b7",
		},
		{
			file: "apps/webapp/src/lib/query/use-time-clock.ts",
			canonicalSha256:
				"001342ea60ed27c025163c61ed42435f8a47c73a04557955a17370fbc027e9b2",
			gitBlob: "bf0a6d33af364561b7dd1c2c20bb031f82aeaa7a",
		},
		{
			file: "apps/webapp/src/lib/query/index.ts",
			canonicalSha256:
				"baafe6c1eafdb611ae110eab67b592d6bf60ae8657455645fa756ee83b34afed",
			gitBlob: "ab807ce7e2f89e6b517c5d4d909e015964ce221e",
		},
		{
			file: "apps/webapp/src/lib/query/keys.ts",
			canonicalSha256:
				"02be0171f15400de999450b37fb9632dfc46da9c5a0fc4606c22e7c15f6f04d4",
			gitBlob: "3d6c28dbd542c7371260cbc0dc425510f55a48e4",
		},
		{
			file: "apps/webapp/src/hooks/use-offline-clock.ts",
			canonicalSha256:
				"3ab3c866b6113da7e08146e2c0edfa3fcf5334bbfdc32b6b6d7656fa6270863a",
			gitBlob: "7325bda0eff56f1c1925602a7dc4917d7367c703",
		},
		{
			file: "apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx",
			canonicalSha256:
				"eaa17bfd57424bf88cb92de2df738807b1442327faddf1816a85663b576f73ad",
			gitBlob: "b4a20bb475073a7215ddd88ec829fb22c1b65c91",
		},
		{
			file: "apps/webapp/src/components/ui/button.tsx",
			canonicalSha256:
				"cdd578f9ecd1c4d79e9c9d326bcc0e0142376b8b58c20d90fd26fa9228542d8c",
			gitBlob: "7b07cb7cefe2aa67250a7012adb7df2650dfd39e",
		},
		{
			file: "apps/webapp/src/components/ui/popover.tsx",
			canonicalSha256:
				"956b2cc3f38a64a46c9fdef385e6ece638e555d684afd5307e43c48665c967ab",
			gitBlob: "6ed14bb30d50f5954a402767c97034bf27b434aa",
		},
		{
			file: "apps/webapp/src/components/ui/base-ui-compat.ts",
			canonicalSha256:
				"131ec3b182253f7cfdbc3062f72b7a1d54544f8de1aeac4d2759b6a08dfc8666",
			gitBlob: "7d0c48a76a6cb03eedf4b4727c0a60182e89c2ce",
		},
	].map(Object.freeze),
);
const webClockOriginal='2ef3b3f17ea61d65570f23c46f92d1d320f5ef25',webClockHead='405ab67fa4cf05800a51526c4d67bc52c001a08b';
export const reviewedWebClockStatusLegacyFiles=Object.freeze(reviewedLegacyClockFiles.map(row=>Object.freeze(row.file==='apps/webapp/src/lib/query/use-time-clock.ts'?{...row,canonicalSha256:'6b01dcb420acd88cce52f233ce78e05eebcea978a9b1fb5c813cdf12b3d46ae5',gitBlob:'8e2342c0be4e1b57e19962e8b5859f6d8735f736'}:{...row})));
export const reviewedWebClockStatusTransportFiles=Object.freeze([
 ['apps/webapp/src/app/api/time-clock/status/route.ts','ebf43785a4a238742b90f6d00536ed31bdbe1f94b6028a5c1044c3e91475c4d3','83dcc4b7e902b65f3622f66e2b3efa5aad61e7ca'],
 ['apps/webapp/src/lib/time-tracking/web-clock-status.ts','c559558e97e9705207c7f2aba06aed7d9a1800ecfa7f25473fb753b2b9d4a1d8','94f26bab6caa25dfb150257197e6fa7fd04f0ce1'],
 ['apps/webapp/src/lib/time-tracking/web-clock-status-client.ts','608a54052a0f03c5acc47facd59faf3dc8d98302224f753fd31bcef27d8c6255','8a5281a67b51a6a536f5adeff39b7c80f45a59ed'],
 ['apps/webapp/src/lib/projects/project-task-model.ts','84ba384777230b9569c522b4c110bdf65dcca1e671da91863e81a4771b93f75e','353aac9aaf25c1eb34ddcf7367e8d00a33221b99'],
].map(([file,canonicalSha256,gitBlob])=>Object.freeze({file,canonicalSha256,gitBlob})));
function legacyFilesForSource(compiledBuild){assert.notEqual(compiledBuild,webClockHead);return compiledBuild===webClockOriginal?reviewedWebClockStatusLegacyFiles:reviewedLegacyClockFiles;}
function transportCertificate(f){
 const c=f.configuration,common=f.transportCertificate,correction=common?.approvedWebClockStatusCorrection;
 assert.equal(f.phase,'baseline');assert.equal(f.transportSourceSha256,c.transportSource.sha256);assert.equal(f.review.transportSourceSha256,c.transportSource.sha256);
 assert.equal(common.schema,1);assert.equal(common.kind,'identical-common7-plus-approved-admin-advisory-and-web-clock-status-hunks-provenance-v33');
 assert.equal(common.originalBinarySource,webClockOriginal);assert.equal(common.headBinarySource,webClockHead);assert.equal(common.originalBusinessSource,'39a08d0bbe77e00ceb5b204b9f9100ab2cfb86be');
 for(const key of ['userApproved','ready','sourceQualificationComplete'])assert.equal(common[key],true);
 assert.equal(common.builds.original.source,webClockOriginal);assert.equal(common.builds.head.source,webClockHead);assert.equal(common.builds.original.requiredServerFilesSha256,f.manifestSha256);assert.equal(common.builds.original.recordSha256,c.buildRecord.sha256);assert.ok(digest(common.builds.head.requiredServerFilesSha256));
 assert.equal(correction.userApproved,true);assert.equal(correction.identicalHunks,true);
 const hook=reviewedWebClockStatusLegacyFiles.find(row=>row.file==='apps/webapp/src/lib/query/use-time-clock.ts'),changed=[...reviewedWebClockStatusTransportFiles.slice(0,3),hook];
 assert.deepEqual(correction.productionPaths.slice().sort(),changed.map(row=>row.file).sort());assert.equal(correction.records.length,4);
 const check=(row,pin)=>{exactKeys(row,['file','canonicalSha256','gitBlob','physicalSha256']);for(const key of ['file','canonicalSha256','gitBlob'])assert.equal(row[key],pin[key]);assert.ok(digest(row.physicalSha256));};
 for(const pin of changed){const records=correction.records.filter(row=>row.file===pin.file);assert.equal(records.length,1);const row=records[0];assert.ok(digest(row.signedHunkSha256));check(row.phases.original,pin);const actual=[...f.sourceFacts,...f.transportFacts].find(item=>item.file===pin.file);assert.equal(actual?.physicalSha256,row.phases.original.physicalSha256);check(row.phases.head,pin===hook?{...pin,canonicalSha256:'7e75bac444559faa4b28f61272814a12c5151cbe0e62328f210a3e334f0d0fd3',gitBlob:'e8f7250a3a14c9bbffdb8af3ec6b23f460cb61f2'}:pin);}
 assert.equal(correction.transportClosure.length,4);assert.equal(f.transportFacts?.length,4);
 for(let i=0;i<4;i++){const pin=reviewedWebClockStatusTransportFiles[i],row=correction.transportClosure[i];assert.equal(row.file,pin.file);check(row.phases.original,pin);check(row.phases.head,pin);check(f.transportFacts[i],pin);assert.equal(f.transportFacts[i].physicalSha256,row.phases.original.physicalSha256);}
}
function exactKeys(value, keys) {
	assert.ok(value && typeof value === "object" && !Array.isArray(value));
	assert.deepEqual(Object.keys(value).sort(), keys.slice().sort());
}
function validateSource(f) {
	const c = f.configuration,
		r = f.review,files=legacyFilesForSource(f.compiledBuild),webClock=f.compiledBuild===webClockOriginal;
	exactKeys(c, [
		"protocol",
		"compiledBuild",
		"compiledManifestSha256",
		"originSha256",
		"phase",
		"review",
		"buildRecord",
		...(webClock?["transportSource"]:[]),
	]);
	assert.equal(c.protocol, legacyClockReadinessProtocol);
	for (const ref of [c.review, c.buildRecord,...(webClock?[c.transportSource]:[])]) {
		exactKeys(ref, ["path", "sha256"]);
		assert.ok(
			isAbsolute(ref.path) && ref.path.length <= 1024 && digest(ref.sha256),
		);
	}
	assert.ok(source(f.compiledBuild) && digest(f.manifestSha256));
	assert.ok(["baseline", "release"].includes(f.phase));
	const origin = new URL(f.origin);
	assert.equal(origin.protocol, "http:");
	assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
	assert.equal(origin.pathname, "/");
	assert.equal(
		origin.search + origin.hash + origin.username + origin.password,
		"",
	);
	exactKeys(r, [
		"schema",
		"kind",
		"accepted",
		"compiledBuild",
		"compiledManifestSha256",
		"sourceCommit",
		"originSha256",
		"phase",
		"buildRecordSha256",
		"files",
		...(webClock?["transportSourceSha256"]:[]),
	]);
	assert.equal(r.schema, 1);
	assert.equal(r.kind, "root-reviewed-legacy-header-readiness-source-v1");
	assert.equal(r.accepted, true);
	for (const [key, value] of Object.entries({
		compiledBuild: f.compiledBuild,
		compiledManifestSha256: f.manifestSha256,
		originSha256: sha(origin.origin),
		phase: f.phase,
	})) {
		assert.equal(c[key], value, key);
		assert.equal(r[key], value, key);
	}
	assert.equal(r.sourceCommit, f.compiledBuild);
	assert.equal(r.buildRecordSha256, c.buildRecord.sha256);
	const b = f.buildRecord;
	assert.equal(b.source, f.compiledBuild);
	assert.equal(b.ci, true);
	assert.equal(b.exitCode, 0);
	assert.equal(typeof b.buildId, "string");
	assert.ok(b.buildId.length > 0 && b.buildId.length <= 256);
	assert.equal(b.buildId, f.buildId);
	assert.ok(
		Number.isFinite(Date.parse(b.startedAt)) &&
			Number.isFinite(Date.parse(b.finishedAt)) &&
			Date.parse(b.startedAt) <= Date.parse(b.finishedAt),
	);
	assert.equal(r.files?.length, files.length);
	assert.equal(f.sourceFacts?.length, files.length);
	for (let i = 0; i < files.length; i++) {
		const known = files[i],
			actual = f.sourceFacts[i],
			reviewed = r.files[i];
		for (const row of [actual, reviewed]) {
			exactKeys(row, ["file", "canonicalSha256", "gitBlob", "physicalSha256"]);
			for (const key of ["file", "canonicalSha256", "gitBlob"])
				assert.equal(row[key], known[key], key);
			assert.ok(digest(row.physicalSha256));
		}
		assert.equal(actual.physicalSha256, reviewed.physicalSha256);
	}
	if(webClock)transportCertificate(f);
	return Object.freeze({
		...(webClock?{transportSourceSha256:c.transportSource.sha256}:{}),
		protocol: legacyClockReadinessProtocol,
		compiledBuild: f.compiledBuild,
		compiledManifestSha256: f.manifestSha256,
		originSha256: sha(origin.origin),
		phase: f.phase,
		reviewSha256: c.review.sha256,
		buildRecordSha256: c.buildRecord.sha256,
	});
}
/** No private JSON, assertion values, paths or nested error causes leave this seam. */
export function validateLegacyClockReadinessSource(f) {
	try {
		return validateSource(f);
	} catch {
		throw new Error("Legacy clock readiness source qualification failed.");
	}
}
async function bounded(path, max) {
	const file = await open(path, "r");
	try {
		const before = await file.stat({ bigint: true });
		assert.ok(before.isFile() && before.size <= BigInt(max));
		const bytes = Buffer.alloc(Number(before.size));
		let offset = 0;
		while (offset < bytes.length) {
			const part = await file.read(
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			assert.ok(part.bytesRead > 0);
			offset += part.bytesRead;
		}
		const after = await file.stat({ bigint: true });
		assert.ok(
			["dev", "ino", "size", "mtimeNs"].every(
				(key) => before[key] === after[key],
			),
		);
		return bytes;
	} finally {
		await file.close();
	}
}
/** Actual file acquisition is only called by the compiled binding reader before browser IO. */
async function readSource({
	configuration,
	manifestPath,
	compiledBuild,
	manifestSha256,
	origin,
	phase,
}) {
	// Validate reference shape before opening a caller path; no acceptance Boolean is consumed alone.
	const files=legacyFilesForSource(compiledBuild),webClock=compiledBuild===webClockOriginal;
	exactKeys(configuration, [
		"protocol",
		"compiledBuild",
		"compiledManifestSha256",
		"originSha256",
		"phase",
		"review",
		"buildRecord",
		...(webClock?["transportSource"]:[]),
	]);
	for (const ref of [configuration.review, configuration.buildRecord,...(webClock?[configuration.transportSource]:[])]) {
		exactKeys(ref, ["path", "sha256"]);
		assert.ok(
			isAbsolute(ref.path) && ref.path.length <= 1024 && digest(ref.sha256),
		);
	}
	const reviewBytes = await bounded(configuration.review.path, 128 * 1024),
		buildBytes = await bounded(configuration.buildRecord.path, 128 * 1024);
	assert.equal(sha(reviewBytes), configuration.review.sha256);
	assert.equal(sha(buildBytes), configuration.buildRecord.sha256);
	const review = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(reviewBytes),
		),
		buildRecord = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(buildBytes),
		);
	const app = resolve(dirname(manifestPath), ".."),
		buildId = new TextDecoder("utf-8", { fatal: true })
			.decode(await bounded(resolve(dirname(manifestPath), "BUILD_ID"), 256))
			.trim();
	const sourceFacts = [];
	let total = 0;
	for (const known of [...files,...(webClock?reviewedWebClockStatusTransportFiles:[])]) {
		const path = resolve(app, known.file.replace("apps/webapp/", ""));
		assert.ok(!relative(app, path).startsWith(".."));
		const bytes = await bounded(path, 256 * 1024);
		assert.ok(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf));
		total += bytes.length;
		assert.ok(total <= 1024 * 1024);
		const canonical = Buffer.from(
			new TextDecoder("utf-8", { fatal: true })
				.decode(bytes)
				.replaceAll("\r\n", "\n"),
		);
		sourceFacts.push({
			file: known.file,
			physicalSha256: sha(bytes),
			canonicalSha256: sha(canonical),
			gitBlob: createHash("sha1")
				.update(`blob ${canonical.length}\0`)
				.update(canonical)
				.digest("hex"),
		});
	}
	let certificate=null,certificateSha=null;
	if(webClock){const bytes=await bounded(configuration.transportSource.path,256*1024);assert.equal(sha(bytes),configuration.transportSource.sha256);assert.ok(!(bytes[0]===239&&bytes[1]===187&&bytes[2]===191));certificate=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));certificateSha=sha(bytes);}
	return validateLegacyClockReadinessSource({
		configuration,
		review,
		buildRecord,
		buildId,
		sourceFacts:sourceFacts.slice(0,files.length),
		...(webClock?{transportFacts:sourceFacts.slice(files.length),transportCertificate:certificate,transportSourceSha256:certificateSha}:{}),
		compiledBuild,
		manifestSha256,
		origin,
		phase,
	});
}
/** Acquisition failures expose only a fixed message; preserving their rejection needs no raw cause. */
export async function readLegacyClockReadinessSource(options) {
	try {
		return await readSource(options);
	} catch {
		throw new Error("Legacy clock readiness source qualification failed.");
	}
}

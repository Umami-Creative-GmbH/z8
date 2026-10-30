import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
	projectCachedCdpText,
	validateCachedCdpTextProjection,
} from "./cdp-cached-text-projection.mjs";

test("ASCII projection retains only bounded byte counts and technical digests", () => {
	const proof = projectCachedCdpText(Buffer.from("ABC"));
	assert.equal(proof.originalBytes, 3);
	assert.equal(proof.outputCodeUnits, 3);
	assert.equal(proof.utf8Bytes, 3);
	assert.equal(
		proof.originalSha256,
		"b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78",
	);
	assert.equal(proof.utf8Sha256, proof.originalSha256);
	assert.equal(
		proof.sourceRevision,
		"d0c02bfad08ec92a6ffcf989e53cd995e6381a4c",
	);
	assert.equal(Object.hasOwn(proof, "eligible"), false);
	assert.equal(Object.hasOwn(proof, "body"), false);
});

test("the fixed 256-byte source mapping includes Windows-1252 C1 and UTF-8 mojibake", () => {
	const proof = projectCachedCdpText(
		Buffer.from(Array.from({ length: 256 }, (_, index) => index)),
	);
	assert.equal(
		proof.mappingSha256,
		"5f883b3909ed608b74067ebb03d75c351259da8f44d13a119c25e5b53fbf9756",
	);
	assert.equal(proof.outputCodeUnits, 256);
	assert.equal(proof.utf8Bytes, 401);
	assert.equal(
		proof.utf8Sha256,
		"cc916e51644a12e8de4ad160910c171a58621ee5dc3a6da6f8b00f8684085f33",
	);
	// C3 A9 becomes the two characters U+00C3/U+00A9, not U+00E9.
	// 80 becomes U+20AC, 81 stays U+0081, and NUL/CR/LF remain present.
	const binary = projectCachedCdpText(
		Buffer.from([0xc3, 0xa9, 0x80, 0x81, 0, 13, 10]),
	);
	assert.equal(binary.outputCodeUnits, 7);
	assert.equal(binary.utf8Bytes, 12);
	assert.equal(
		binary.utf8Sha256,
		"bc37196884054f71f4710f473d10e0ab4369065284a1d5724e4a663bdfe44289",
	);
});

test("unsupported inputs, every Unicode BOM override and oversize inputs are rejected", () => {
	for (const value of [
		undefined,
		null,
		"ABC",
		[65],
		new Uint8Array([65]),
		Buffer.from(new SharedArrayBuffer(1)),
	]) {
		assert.throws(
			() => projectCachedCdpText(value),
			/unsupported-original-buffer/,
		);
	}
	for (const prefix of [
		[0xef, 0xbb, 0xbf],
		[0xff, 0xfe],
		[0xfe, 0xff],
	]) {
		assert.throws(
			() => projectCachedCdpText(Buffer.from([...prefix, 65])),
			/unsupported-bom-prefix/,
		);
	}
	assert.throws(
		() => projectCachedCdpText(Buffer.alloc(8 * 1024 * 1024 + 1)),
		/original-byte-limit/,
	);
	assert.throws(
		() => projectCachedCdpText(Buffer.alloc(2796203, 0x80)),
		/projected-byte-limit/,
	);
});

test("chunk boundaries and both inclusive 8 MiB limits retain every projected byte", () => {
	const original = Buffer.concat([
		Buffer.alloc(32766, 65),
		Buffer.from([0x80, 0x81, 0xff, 0, 13, 10]),
		Buffer.alloc(32766, 0xc3),
	]);
	const expected = Buffer.from(
		new TextDecoder("windows-1252").decode(original),
		"utf8",
	);
	const proof = projectCachedCdpText(original);
	assert.equal(proof.utf8Bytes, expected.length);
	assert.equal(
		proof.utf8Sha256,
		createHash("sha256").update(expected).digest("hex"),
	);
	assert.equal(
		projectCachedCdpText(Buffer.alloc(8 * 1024 * 1024, 65)).utf8Bytes,
		8 * 1024 * 1024,
	);
	const boundary = Buffer.alloc(2796204, 0x80);
	boundary[boundary.length - 1] = 65;
	boundary[boundary.length - 2] = 65;
	assert.equal(projectCachedCdpText(boundary).utf8Bytes, 8 * 1024 * 1024);
	const empty = projectCachedCdpText(Buffer.alloc(0));
	assert.equal(empty.utf8Bytes, 0);
	assert.equal(
		empty.utf8Sha256,
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	);
});

test("exact-schema validation recomputes against original bytes, without retaining raw data", () => {
	const original = Buffer.from("PRIVATE ORIGINAL BODY");
	const proof = projectCachedCdpText(original);
	assert.equal(
		validateCachedCdpTextProjection(
			JSON.parse(JSON.stringify(proof)),
			original,
		),
		true,
	);
	for (const [key, value] of Object.entries(proof)) {
		const tampered = {
			...proof,
			[key]: typeof value === "number" ? value + 1 : "0",
		};
		assert.equal(
			validateCachedCdpTextProjection(tampered, original),
			false,
			key,
		);
	}
	assert.equal(
		validateCachedCdpTextProjection({ ...proof, raw: "PRIVATE" }, original),
		false,
	);
	assert.equal(validateCachedCdpTextProjection(proof), false);
	assert.equal(
		validateCachedCdpTextProjection(proof, Buffer.from("DIFFERENT ORIGINAL")),
		false,
	);
	assert.doesNotMatch(JSON.stringify(proof), /PRIVATE|ORIGINAL|BODY/);
	original.fill(0);
	assert.equal(validateCachedCdpTextProjection(proof, original), false);
});

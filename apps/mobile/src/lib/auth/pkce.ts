import * as Crypto from "expo-crypto";

const VERIFIER_BYTE_LENGTH = 32;

function base64ToBase64Url(value: string) {
	return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToBase64Url(bytes: Uint8Array) {
	let binary = "";

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return base64ToBase64Url(globalThis.btoa(binary));
}

export async function createAppAuthPkcePair() {
	const verifier = bytesToBase64Url(Crypto.getRandomBytes(VERIFIER_BYTE_LENGTH));
	const digest = await Crypto.digestStringAsync(
		Crypto.CryptoDigestAlgorithm.SHA256,
		verifier,
		{
			encoding: Crypto.CryptoEncoding.BASE64,
		},
	);

	return {
		challenge: base64ToBase64Url(digest),
		verifier,
	};
}

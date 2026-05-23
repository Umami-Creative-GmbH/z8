import React from "react";

vi.mock("@expo/ui", async () => await import("./expo-ui-mock"));

vi.mock("@expo/ui/community/datetime-picker", () => {
	function DateTimePicker({ value, onValueChange, onDismiss, testID }: {
		value: Date;
		onValueChange?: (event: unknown, selectedDate: Date) => void;
		onDismiss?: () => void;
		testID?: string;
	}) {
		return React.createElement("DateTimePicker", {
			onDismiss,
			onValueChange,
			testID,
			value,
		});
	}

	return {
		DateTimePicker,
		default: DateTimePicker,
	};
});

vi.mock("expo-crypto", () => ({
	CryptoDigestAlgorithm: {
		SHA256: "SHA-256",
	},
	CryptoEncoding: {
		BASE64: "base64",
	},
	digestStringAsync: vi.fn(async (_algorithm: string, value: string) => `digest:${value}`),
	getRandomBytes: vi.fn(() => new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1))),
}));

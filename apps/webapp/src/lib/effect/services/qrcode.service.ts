import QRCode from "qrcode";
import { Context, Effect, Layer } from "effect";

export type QRCodeFormat = "png" | "svg";

export interface QRCodeOptions {
	width?: number;
	margin?: number;
	color?: {
		dark?: string;
		light?: string;
	};
	errorCorrectionLevel?: "L" | "M" | "Q" | "H";
}

export interface GenerateQRCodeInput {
	data: string;
	format: QRCodeFormat;
	options?: QRCodeOptions;
}

export interface QRCodeResult {
	data: string; // Base64 for PNG, raw SVG string for SVG
	format: QRCodeFormat;
	mimeType: string;
}

export class QRCodeService extends Context.Tag("QRCodeService")<
	QRCodeService,
	{
		// Generate QR code in specified format
		readonly generate: (input: GenerateQRCodeInput) => Effect.Effect<QRCodeResult, Error>;

		// Generate QR code as data URL (for embedding in HTML)
		readonly generateDataUrl: (
			data: string,
			options?: QRCodeOptions,
		) => Effect.Effect<string, Error>;

		// Generate invite URL QR code
		readonly generateInviteQR: (
			code: string,
			baseUrl: string,
			format: QRCodeFormat,
			options?: QRCodeOptions,
		) => Effect.Effect<QRCodeResult, Error>;

		// Generate QR code buffer for download
		readonly generateBuffer: (
			data: string,
			format: QRCodeFormat,
			options?: QRCodeOptions,
		) => Effect.Effect<Buffer, Error>;
	}
>() {}

export const QRCodeServiceLive = Layer.succeed(
	QRCodeService,
	QRCodeService.of({
		generate: (input) =>
			Effect.tryPromise({
				try: async () => {
					const qrOptions: QRCode.QRCodeToStringOptions = {
						width: input.options?.width || 256,
						margin: input.options?.margin || 2,
						color: {
							dark: input.options?.color?.dark || "#000000",
							light: input.options?.color?.light || "#ffffff",
						},
						errorCorrectionLevel: input.options?.errorCorrectionLevel || "M",
					};

					if (input.format === "svg") {
						const svg = await QRCode.toString(input.data, {
							...qrOptions,
							type: "svg",
						});
						return {
							data: svg,
							format: "svg" as const,
							mimeType: "image/svg+xml",
						};
					}

					// PNG format
					const dataUrl = await QRCode.toDataURL(input.data, {
						...qrOptions,
						type: "image/png",
					});
					// Extract base64 data from data URL
					const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
					return {
						data: base64Data,
						format: "png" as const,
						mimeType: "image/png",
					};
				},
				catch: (error) => new Error(`Failed to generate QR code: ${error}`),
			}),

		generateDataUrl: (data, options) =>
			Effect.tryPromise({
				try: async () => {
					const qrOptions: QRCode.QRCodeToDataURLOptions = {
						width: options?.width || 256,
						margin: options?.margin || 2,
						color: {
							dark: options?.color?.dark || "#000000",
							light: options?.color?.light || "#ffffff",
						},
						errorCorrectionLevel: options?.errorCorrectionLevel || "M",
						type: "image/png",
					};

					return await QRCode.toDataURL(data, qrOptions);
				},
				catch: (error) => new Error(`Failed to generate QR code data URL: ${error}`),
			}),

		generateInviteQR: (code, baseUrl, format, options) =>
			Effect.tryPromise({
				try: async () => {
					// Construct the invite URL
					const inviteUrl = `${baseUrl}/join/${code}`;

					const qrOptions: QRCode.QRCodeToStringOptions = {
						width: options?.width || 512, // Higher resolution for invite codes
						margin: options?.margin || 2,
						color: {
							dark: options?.color?.dark || "#000000",
							light: options?.color?.light || "#ffffff",
						},
						errorCorrectionLevel: options?.errorCorrectionLevel || "H", // Higher error correction for print
					};

					if (format === "svg") {
						const svg = await QRCode.toString(inviteUrl, {
							...qrOptions,
							type: "svg",
						});
						return {
							data: svg,
							format: "svg" as const,
							mimeType: "image/svg+xml",
						};
					}

					// PNG format
					const dataUrl = await QRCode.toDataURL(inviteUrl, {
						...qrOptions,
						type: "image/png",
					});
					const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
					return {
						data: base64Data,
						format: "png" as const,
						mimeType: "image/png",
					};
				},
				catch: (error) => new Error(`Failed to generate invite QR code: ${error}`),
			}),

		generateBuffer: (data, format, options) =>
			Effect.tryPromise({
				try: async () => {
					const qrOptions = {
						width: options?.width || 256,
						margin: options?.margin || 2,
						color: {
							dark: options?.color?.dark || "#000000",
							light: options?.color?.light || "#ffffff",
						},
						errorCorrectionLevel: options?.errorCorrectionLevel || "M",
					};

					if (format === "svg") {
						const svg = await QRCode.toString(data, {
							...qrOptions,
							type: "svg",
						});
						return Buffer.from(svg, "utf-8");
					}

					// PNG format
					return await QRCode.toBuffer(data, {
						...qrOptions,
						type: "png",
					});
				},
				catch: (error) => new Error(`Failed to generate QR code buffer: ${error}`),
			}),
	}),
);

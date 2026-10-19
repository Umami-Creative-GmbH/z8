import "server-only";

import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import QRCode from "qrcode";

/** The printed texts around the badge, in the issuer's language. */
export type KioskBadgePdfLabels = {
	/** The badge's caption, e.g. "Kiosk badge". */
	title: string;
	/** The note beside the badge: cut it out, keep it private, replace it when lost. */
	instructions: string;
};

export type KioskBadgePdfInput = {
	employeeName: string;
	organizationName: string;
	credential: string;
	labels: KioskBadgePdfLabels;
};

// ID-1 card size (85.6 x 54 mm) in PDF points, so a printed badge fits a standard card sleeve.
const MM = 72 / 25.4;
const CARD_WIDTH = 85.6 * MM;
const CARD_HEIGHT = 54 * MM;
const QR_SIZE = 40 * MM;
const QR_PIXELS = 600;

const styles = StyleSheet.create({
	page: { padding: 40, fontFamily: "Helvetica", color: "#172033" },
	card: {
		width: CARD_WIDTH,
		height: CARD_HEIGHT,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: "#94a3b8",
		borderRadius: 8,
		padding: 4 * MM,
		flexDirection: "row",
		alignItems: "center",
	},
	qr: { width: QR_SIZE, height: QR_SIZE },
	details: { flex: 1, marginLeft: 3 * MM },
	organization: { fontSize: 8, color: "#475569", marginBottom: 4 },
	name: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 6 },
	title: { fontSize: 7, color: "#64748b", textTransform: "uppercase" },
	instructions: { marginTop: 16, width: 360, fontSize: 9, lineHeight: 1.4, color: "#475569" },
});

/**
 * A kiosk badge as a printable PDF (#1364): one ID-1 sized card with the
 * employee's name, the organization and the QR code holding the credential,
 * plus a note for whoever prints it. Rendered once, during issuance; the
 * credential is never stored, so the same PDF cannot be produced again.
 */
export async function renderKioskBadgePdf(input: KioskBadgePdfInput): Promise<Buffer> {
	const qr = await QRCode.toBuffer(input.credential, {
		type: "png",
		errorCorrectionLevel: "Q",
		margin: 4,
		width: QR_PIXELS,
		color: { dark: "#000000ff", light: "#ffffffff" },
	});
	return renderToBuffer(
		<Document title={input.labels.title} author="Z8">
			<Page size="A4" style={styles.page}>
				<View style={styles.card} wrap={false}>
					<Image style={styles.qr} src={{ data: qr, format: "png" }} />
					<View style={styles.details}>
						<Text style={styles.organization}>{input.organizationName}</Text>
						<Text style={styles.name}>{input.employeeName}</Text>
						<Text style={styles.title}>{input.labels.title}</Text>
					</View>
				</View>
				<Text style={styles.instructions}>{input.labels.instructions}</Text>
			</Page>
		</Document>,
	);
}

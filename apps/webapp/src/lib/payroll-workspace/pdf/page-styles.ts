export const PDF_COLORS = {
	ink: "#0F172A",
	text: "#1F2937",
	muted: "#64748B",
	rule: "#CBD5E1",
	faintRule: "#E2E8F0",
	accent: "#1D4ED8",
	headerFill: "#1E3A8A",
	weekendFill: "#F8FAFC",
	settled: "#047857",
	changed: "#B45309",
} as const;

export const PAGE_TOP = 28;
const PAGE_SIDE = 36;

export const basePageStyle = {
	paddingTop: 34,
	paddingRight: PAGE_SIDE,
	paddingBottom: 48,
	paddingLeft: PAGE_SIDE,
	fontFamily: "Helvetica",
	fontSize: 9,
	lineHeight: 1.35,
	color: PDF_COLORS.text,
} as const;

export const frameStyles = {
	header: {
		position: "absolute" as const,
		top: PAGE_TOP,
		left: PAGE_SIDE,
		right: PAGE_SIDE,
		backgroundColor: "#FFFFFF",
	},
	footer: {
		position: "absolute" as const,
		left: PAGE_SIDE,
		right: PAGE_SIDE,
		bottom: 22,
		paddingTop: 6,
		borderTopWidth: 1,
		borderTopColor: PDF_COLORS.rule,
		flexDirection: "row" as const,
		justifyContent: "space-between" as const,
		fontSize: 7,
		color: PDF_COLORS.muted,
	},
} as const;

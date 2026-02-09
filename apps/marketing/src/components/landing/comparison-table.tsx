import { v } from "@/components/theme/tokens";
import { comparisons } from "./data";

export function ComparisonTable() {
	return (
		<section className="relative z-10 px-8 py-28 lg:px-16">
			<div className="mx-auto max-w-3xl">
				<div className="mb-14 text-center">
					<span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em]" style={{ color: v("textTertiary") }}>
						Vergleich
					</span>
					<h2 className="text-[clamp(1.6rem,3vw,2.4rem)] font-bold tracking-[-0.02em]">
						Z8 vs. herk&ouml;mmliche Tools.
					</h2>
				</div>
				<div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${v("borderMedium")}` }}>
					<div
						className="grid grid-cols-[1fr_80px_80px] gap-px px-6 py-4 text-[12px] font-bold uppercase tracking-[0.1em]"
						style={{ backgroundColor: v("bgAlt"), borderBottom: `1px solid ${v("borderMedium")}` }}
					>
						<span style={{ color: v("textTertiary") }}>Funktion</span>
						<span className="text-center" style={{ color: v("text") }}>Z8</span>
						<span className="text-center" style={{ color: v("textQuaternary") }}>Andere</span>
					</div>
					{comparisons.map((c, i) => (
						<div
							key={i}
							className="grid grid-cols-[1fr_80px_80px] items-center px-6 py-3.5 text-[14px]"
							style={{
								borderBottom: i < comparisons.length - 1 ? `1px solid ${v("border")}` : "none",
								backgroundColor: i % 2 === 0 ? v("comparisonRowEven") : v("comparisonRowOdd"),
							}}
						>
							<span style={{ color: v("textFaint") }}>{c.feature}</span>
							<span className="text-center">
								{c.z8 ? (
									<span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px]" style={{ backgroundColor: v("surface"), color: v("surfaceText") }}>&#10003;</span>
								) : (
									<span style={{ color: v("textQuaternary") }}>&mdash;</span>
								)}
							</span>
							<span className="text-center">
								{c.others ? (
									<span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px]" style={{ backgroundColor: v("checkOtherBg"), color: v("checkOtherText") }}>&#10003;</span>
								) : (
									<span style={{ color: v("textQuaternary") }}>&mdash;</span>
								)}
							</span>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

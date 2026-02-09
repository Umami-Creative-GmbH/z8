import { v } from "@/components/theme/tokens";
import { featuresGridItems } from "./data";

export function FeaturesGrid() {
	return (
		<section id="features" className="relative z-10 px-8 py-28 lg:px-16" style={{ backgroundColor: v("bgAlt"), transition: "background-color 0.4s ease" }}>
			<div className="mx-auto max-w-5xl">
				<div className="mb-16 text-center">
					<span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em]" style={{ color: v("textTertiary") }}>
						Funktionen
					</span>
					<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
						Alles, was Ihr Team braucht.
					</h2>
					<p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed" style={{ color: v("textMuted") }}>
						Sechs Kernmodule. Null Kompromisse. Jedes einzelne so gebaut, dass es allein bestehen k&ouml;nnte &mdash; zusammen sind sie unschlagbar.
					</p>
				</div>
				<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
					{featuresGridItems.map((f, i) => (
						<div
							key={i}
							className="group rounded-2xl p-7 transition-all hover:-translate-y-1 hover:shadow-lg"
							style={{ border: `1px solid ${v("border")}`, backgroundColor: v("cardBg"), transition: "background-color 0.4s ease, border-color 0.4s ease" }}
						>
							<div
								className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl text-[12px] font-bold"
								style={{ backgroundColor: v("surface"), color: v("surfaceText") }}
							>
								{String(i + 1).padStart(2, "0")}
							</div>
							<h3 className="mb-2 text-[16px] font-bold">{f.title}</h3>
							<p className="text-[13px] leading-[1.7]" style={{ color: v("textMuted") }}>{f.desc}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

import { v } from "@/components/theme/tokens";
import type { LandingCopy } from "@/i18n/landing-copy";

type IntegrationsProps = {
	copy: LandingCopy["integrations"];
};

export function Integrations({ copy }: IntegrationsProps) {
	return (
		<section
			id="integrations"
			className="relative z-10 px-8 py-28 lg:px-16"
			style={{ backgroundColor: v("bgAlt"), transition: "background-color 0.4s ease" }}
		>
			<div className="mx-auto max-w-5xl">
				<div className="mb-16 text-center">
					<span
						className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em]"
						style={{ color: v("textTertiary") }}
					>
						{copy.eyebrow}
					</span>
					<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">{copy.title}</h2>
					<p
						className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed"
						style={{ color: v("textMuted") }}
					>
						{copy.description}
					</p>
				</div>
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
					{copy.items.map((integration) => (
						<div
							key={integration.id}
							className="group flex flex-col items-center justify-center rounded-2xl px-5 py-8 text-center transition-all hover:-translate-y-1 hover:shadow-md"
							style={{
								border: `1px solid ${v("border")}`,
								backgroundColor: v("cardBg"),
								transition: "background-color 0.4s ease",
							}}
						>
							<div
								className="mb-3 flex size-12 items-center justify-center rounded-xl text-[14px] font-black"
								style={{ backgroundColor: v("iconBg"), color: v("text") }}
							>
								{integration.name.slice(0, 2).toUpperCase()}
							</div>
							<span className="text-[14px] font-semibold">{integration.name}</span>
							<span className="mt-1 text-[11px]" style={{ color: v("textTertiary") }}>
								{integration.category}
							</span>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

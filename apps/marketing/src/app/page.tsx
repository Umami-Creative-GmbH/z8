import Link from "next/link";

const designs = [
	{ id: 1, name: "Swiss Brutalist", desc: "Dark, monochrome, ultra-structured grid" },
	{ id: 2, name: "Warm Editorial", desc: "Serif-heavy, cream palette, magazine feel" },
	{ id: 3, name: "Neo-Industrial", desc: "Monospace, amber accents on charcoal" },
	{ id: 4, name: "Soft Organic", desc: "Pastel, rounded, playful gradients" },
	{ id: 5, name: "High Contrast Geometric", desc: "Black & white, electric blue accent, art-deco" },
	{ id: 6, name: "Dunkles Magazin", desc: "Dark editorial, gold accents, luxury serif typography" },
	{ id: 7, name: "Helles Raster", desc: "Warm Swiss grid, classic red, numbered precision" },
	{ id: 8, name: "Tintenblatt", desc: "Newspaper broadsheet, Impact headlines, ink-on-newsprint" },
	{ id: 9, name: "Atelier", desc: "Studio monograph, sage accents, overlapping compositions" },
	{ id: 10, name: "Zen Minimal", desc: "Japanese ma, thin lines, warm stone, extreme whitespace" },
	{ id: 11, name: "Neon Noir", desc: "Dark bg, neon gradients, modern tech startup aesthetic" },
	{ id: 12, name: "Bauhaus Primär", desc: "Primary colors, geometric shapes, constructivist bold" },
	{ id: 13, name: "Nordisch", desc: "Scandinavian cool, ice blue, functional cleanliness" },
	{ id: 14, name: "Terra", desc: "Terracotta earth tones, organic warmth, natural palette" },
	{ id: 15, name: "Blueprint", desc: "Technical drawing, blueprint blue, engineering precision" },
	{ id: 16, name: "Glasfrost", desc: "Glassmorphism, frosted panels, translucent dark UI" },
	{ id: 17, name: "Film Grain", desc: "Cinematic noir, high contrast, dramatic grain overlay" },
	{ id: 18, name: "Kupfer & Stein", desc: "Copper + dark slate, industrial luxury, tactile" },
	{ id: 19, name: "Origami", desc: "Paper-fold layers, subtle shadows, clean depth" },
	{ id: 20, name: "Waldgrün", desc: "Deep green monochromatic, nature-meets-precision" },
];

export default function Home() {
	return (
		<main
			className="flex min-h-screen flex-col items-center justify-center gap-12 p-8"
			style={{ fontFamily: "system-ui, sans-serif" }}
		>
			<div className="text-center">
				<h1 className="text-6xl font-black tracking-tight">Z8</h1>
				<p className="mt-3 text-lg text-neutral-500">Marketing Page Concepts</p>
			</div>
			<div className="grid w-full max-w-2xl gap-4">
				{designs.map((d) => (
					<Link
						key={d.id}
						href={`/${d.id}`}
						className="group flex items-center justify-between rounded-xl border border-neutral-200 px-6 py-5 transition-all hover:border-neutral-400 hover:bg-neutral-50"
					>
						<div>
							<span className="text-xs font-bold tracking-widest text-neutral-400">{String(d.id).padStart(2, "0")}</span>
							<h2 className="text-lg font-semibold">{d.name}</h2>
							<p className="text-sm text-neutral-500">{d.desc}</p>
						</div>
						<span className="text-2xl text-neutral-300 transition-transform group-hover:translate-x-1 group-hover:text-neutral-600">
							&rarr;
						</span>
					</Link>
				))}
			</div>
		</main>
	);
}

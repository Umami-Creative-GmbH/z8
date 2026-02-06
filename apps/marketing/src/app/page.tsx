import Link from "next/link";

const designs = [
	{ id: "6", name: "Dunkles Magazin", desc: "Dark editorial, gold accents, luxury serif typography" },
	{ id: "7", name: "Helles Raster", desc: "Warm Swiss grid, classic red, numbered precision" },
	{ id: "13", name: "Nordisch", desc: "Scandinavian cool, ice blue, functional cleanliness" },
	{ id: "20", name: "Waldgrün", desc: "Deep green monochromatic, nature-meets-precision" },
	{ id: "22", name: "Magma", desc: "Volcanic dark theme, molten orange gradients, raw energy" },
	{ id: "24", name: "Chrom", desc: "Liquid chrome, reflective silver, futuristic metallic sheen" },
	{ id: "24-1", name: "Chrom — Schmelze", desc: "Melting chrome, asymmetric flow, silver bleeding into gold" },
	{ id: "24-2", name: "Chrom — Spiegel", desc: "Mirror symmetry, black-on-white flip, reflected typography" },
	{ id: "24-3", name: "Chrom — Platin", desc: "Platinum luxury, warm light theme, editorial serif refinement" },
	{ id: "24-4", name: "Chrom — Titan", desc: "Titanium brutalist, monospace, exposed grid, industrial blue-gray" },
	{ id: "24-5", name: "Chrom — Prisma", desc: "Prismatic refractions, iridescent color shifts, holographic dark" },
	{ id: "m-1", name: "SaaS — Produktiv", desc: "Clean white, feature chips, floating app mockup, bold sans" },
	{ id: "m-2", name: "SaaS — Attio", desc: "Giant centered serif, ultra-minimal, product UI rising from bottom" },
	{ id: "m-3", name: "SaaS — Cinematic", desc: "Revolut-inspired dark, 3D geometric pedestals, dramatic lighting" },
	{ id: "m-4", name: "SaaS — Zentrale", desc: "Dark with floating product cards, green accent, perspective tilt" },
	{ id: "m-5", name: "SaaS — Editorial", desc: "Warm editorial serif, split hero with stats, app screenshot overlay" },
	{ id: "m-6", name: "SaaS — Gradient", desc: "Vibrant indigo-to-purple gradient, glass dashboard, modern dark" },
	{ id: "p-1", name: "Prisma — Produktiv", desc: "Clean white split hero, spectral chips, rainbow app mockup" },
	{ id: "p-2", name: "Prisma — Serif", desc: "Centered serif headline, prismatic gradient text, product rising from bottom" },
	{ id: "p-3", name: "Prisma — Syne", desc: "Light lavender, Syne typography, spectral dashboard, bold prismatic hero" },
	{ id: "p-4", name: "Prisma — Zentrale", desc: "White with floating prismatic product cards, rainbow accents, perspective tilt" },
	{ id: "p-5", name: "Prisma — Editorial", desc: "Warm editorial serif, spectral stats, prismatic app screenshot overlay" },
	{ id: "p-6", name: "Prisma — Gradient", desc: "Light glass dashboard, full rainbow spectrum, logo bar, soft purple tones" },
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
							<span className="text-xs font-bold tracking-widest text-neutral-400">{d.id.toUpperCase()}</span>
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

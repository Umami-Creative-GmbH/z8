import Image from "next/image";
import Link from "next/link";

export default function Design5() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Gill Sans', 'Century Gothic', 'Futura', sans-serif",
				backgroundColor: "#ffffff",
				color: "#0a0a0a",
			}}
		>
			{/* Header */}
			<header className="flex items-center justify-between px-8 py-6 lg:px-16">
				<div className="flex items-center gap-3">
					<div
						className="flex h-10 w-10 items-center justify-center text-sm font-black text-white"
						style={{ backgroundColor: "#0a0a0a" }}
					>
						Z8
					</div>
				</div>
				<nav className="hidden items-center gap-10 text-[13px] font-medium uppercase tracking-[0.15em] md:flex">
					<a href="#features" className="text-[#999] transition-colors hover:text-[#0a0a0a]">
						Features
					</a>
					<a href="#about" className="text-[#999] transition-colors hover:text-[#0a0a0a]">
						About
					</a>
					<a href="#contact" className="text-[#999] transition-colors hover:text-[#0a0a0a]">
						Contact
					</a>
				</nav>
				<a
					href="#contact"
					className="px-6 py-2.5 text-[12px] font-bold uppercase tracking-[0.15em] text-white transition-colors hover:opacity-90"
					style={{ backgroundColor: "#2563eb" }}
				>
					Get Started
				</a>
			</header>

			{/* Hero - Diagonal split with image */}
			<section className="relative overflow-hidden px-8 pb-32 pt-20 lg:px-16">
				{/* Diagonal geometric background with image */}
				<div className="pointer-events-none absolute inset-0 z-0">
					<div
						className="absolute right-0 top-0 h-full w-1/2 overflow-hidden"
						style={{
							clipPath: "polygon(20% 0%, 100% 0%, 100% 100%, 0% 100%)",
						}}
					>
						<Image
							src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&q=80&auto=format&fit=crop"
							alt=""
							fill
							className="object-cover"
							style={{ filter: "brightness(0.15) contrast(1.2)" }}
							priority
						/>
					</div>
					{/* Electric blue accent triangle */}
					<div
						className="absolute right-[15%] top-[10%] h-48 w-48 opacity-80"
						style={{
							backgroundColor: "#2563eb",
							clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
						}}
					/>
					{/* White geometric circle */}
					<div
						className="absolute bottom-[15%] right-[25%] h-24 w-24 rounded-full"
						style={{ border: "2px solid rgba(255,255,255,0.2)" }}
					/>
				</div>

				<div className="relative z-10">
					<p
						className="animate-fade-up mb-6 text-[11px] font-bold uppercase tracking-[0.5em]"
						style={{ color: "#2563eb", animationDelay: "0.1s" }}
					>
						Workforce Management
					</p>

					<h1 className="animate-fade-up max-w-3xl" style={{ animationDelay: "0.2s" }}>
						<span className="block text-[clamp(3rem,8vw,6.5rem)] font-black uppercase leading-[0.9] tracking-[-0.04em]">
							Time
						</span>
						<span className="block text-[clamp(3rem,8vw,6.5rem)] font-black uppercase leading-[0.9] tracking-[-0.04em]">
							Tracking
						</span>
						<span
							className="block text-[clamp(3rem,8vw,6.5rem)] font-black uppercase leading-[0.9] tracking-[-0.04em]"
							style={{ color: "#2563eb" }}
						>
							Perfected.
						</span>
					</h1>

					<p
						className="animate-fade-up mt-10 max-w-md text-[15px] leading-relaxed text-[#666]"
						style={{ animationDelay: "0.4s" }}
					>
						GoBD-compliant workforce management built for precision. Clock in from any device.
						Export to any payroll system. Audit-ready by design.
					</p>

					<div
						className="animate-fade-up mt-10 flex items-center gap-4"
						style={{ animationDelay: "0.5s" }}
					>
						<a
							href="#contact"
							className="px-8 py-4 text-[12px] font-bold uppercase tracking-[0.2em] text-white transition-transform hover:scale-105"
							style={{ backgroundColor: "#2563eb" }}
						>
							Start Free Trial
						</a>
						<a
							href="#features"
							className="px-8 py-4 text-[12px] font-bold uppercase tracking-[0.2em] transition-colors hover:bg-[#f5f5f5]"
							style={{ border: "2px solid #0a0a0a" }}
						>
							Learn More
						</a>
					</div>
				</div>
			</section>

			{/* Stats bar */}
			<section
				className="px-8 py-12 lg:px-16"
				style={{ backgroundColor: "#0a0a0a", color: "#ffffff" }}
			>
				<div className="grid grid-cols-2 gap-8 md:grid-cols-4">
					{[
						{ num: "99.9%", label: "Uptime" },
						{ num: "50k+", label: "Nutzer" },
						{ num: "4", label: "Plattformen" },
						{ num: "<1s", label: "Sync-Zeit" },
					].map((s) => (
						<div key={s.label} className="text-center">
							<span
								className="block text-3xl font-black tracking-tight"
								style={{ color: "#2563eb" }}
							>
								{s.num}
							</span>
							<span className="mt-1 block text-[11px] uppercase tracking-[0.3em] text-white/40">
								{s.label}
							</span>
						</div>
					))}
				</div>
			</section>

			{/* Features */}
			<section id="features" className="px-8 py-32 lg:px-16">
				<div className="mb-20 flex flex-col items-start gap-4 md:flex-row md:items-end md:justify-between">
					<div>
						<p
							className="mb-2 text-[11px] font-bold uppercase tracking-[0.5em]"
							style={{ color: "#2563eb" }}
						>
							Features
						</p>
						<h2 className="text-4xl font-black uppercase tracking-tight">Built Different.</h2>
					</div>
					<p className="max-w-sm text-[14px] leading-relaxed text-[#999]">
						Jede Funktion durchdacht. Jedes Detail bewusst gew&auml;hlt. Keine Kompromisse.
					</p>
				</div>

				<div className="grid gap-6 md:grid-cols-2">
					{[
						{
							title: "Stempeluhr",
							desc: "Web, Desktop, Mobile, Browser. Ein Klick. Sofort synchron.",
							accent: "#2563eb",
						},
						{
							title: "GoBD-Audit",
							desc: "Revisionssicher. Unver\u00e4nderbar. Digital signiert. WORM-f\u00e4hig.",
							accent: "#0a0a0a",
						},
						{
							title: "Lohnexport",
							desc: "DATEV, Lexware, Personio, SAP. Automatisch und fehlerfrei.",
							accent: "#0a0a0a",
						},
						{
							title: "Enterprise SSO",
							desc: "SAML, OIDC, SCIM, Passkeys. Zero-Trust Identity Management.",
							accent: "#2563eb",
						},
					].map((f, i) => (
						<div
							key={i}
							className="group relative overflow-hidden p-10 transition-colors hover:text-white"
							style={{ border: "2px solid #e5e5e5" }}
						>
							{/* Hover fill */}
							<div
								className="absolute inset-0 origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100"
								style={{ backgroundColor: f.accent }}
							/>
							<div className="relative z-10">
								<h3 className="mb-3 text-2xl font-black uppercase tracking-tight">{f.title}</h3>
								<p className="text-[14px] leading-relaxed text-[#999] transition-colors group-hover:text-white/70">
									{f.desc}
								</p>
							</div>
						</div>
					))}
				</div>
			</section>

			{/* Full-width architectural image */}
			<section className="relative h-[50vh] overflow-hidden">
				<Image
					src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1920&q=80&auto=format&fit=crop"
					alt=""
					fill
					className="object-cover"
					style={{ filter: "contrast(1.1)" }}
				/>
				<div
					className="absolute inset-0"
					style={{
						background:
							"linear-gradient(180deg, rgba(255,255,255,1) 0%, transparent 15%, transparent 85%, rgba(255,255,255,1) 100%)",
					}}
				/>
				<div className="absolute inset-0 flex items-center justify-center">
					<div className="text-center">
						<p
							className="text-[11px] font-bold uppercase tracking-[0.5em]"
							style={{ color: "#2563eb" }}
						>
							Designed for
						</p>
						<p className="mt-2 text-5xl font-black uppercase tracking-tight text-[#0a0a0a]">
							Excellence
						</p>
					</div>
				</div>
			</section>

			{/* About / Diagonal section */}
			<section id="about" className="relative overflow-hidden px-8 py-32 lg:px-16">
				<div
					className="absolute inset-0"
					style={{
						backgroundColor: "#f7f7f7",
						clipPath: "polygon(0 8%, 100% 0%, 100% 92%, 0% 100%)",
					}}
				/>
				<div className="relative z-10 mx-auto max-w-3xl text-center">
					<p
						className="mb-4 text-[11px] font-bold uppercase tracking-[0.5em]"
						style={{ color: "#2563eb" }}
					>
						Philosophie
					</p>
					<h2 className="mb-6 text-4xl font-black uppercase tracking-tight">
						Precision is Everything.
					</h2>
					<p className="text-[16px] leading-[1.8] text-[#666]">
						Wir haben Z8 gebaut, weil Zeiterfassung kein Nachgedanke sein sollte. Jede Minute
						z&auml;hlt &mdash; und verdient eine Software, die das widerspiegelt. Klar,
						pr&auml;zise, unbestechlich.
					</p>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="px-8 py-32 lg:px-16">
				<div className="grid items-center gap-16 md:grid-cols-2">
					<div>
						<p
							className="mb-3 text-[11px] font-bold uppercase tracking-[0.5em]"
							style={{ color: "#2563eb" }}
						>
							Get Started
						</p>
						<h2 className="mb-6 text-4xl font-black uppercase tracking-tight">
							Ready to Transform Time Tracking?
						</h2>
						<p className="mb-8 text-[15px] leading-relaxed text-[#666]">
							Starten Sie kostenlos. Erleben Sie den Unterschied, den durchdachte Zeiterfassung
							macht.
						</p>
						<div className="flex gap-4">
							<a
								href="mailto:hello@z8.app"
								className="px-8 py-4 text-[12px] font-bold uppercase tracking-[0.2em] text-white transition-transform hover:scale-105"
								style={{ backgroundColor: "#2563eb" }}
							>
								Demo anfragen
							</a>
							<a
								href="mailto:hello@z8.app"
								className="px-8 py-4 text-[12px] font-bold uppercase tracking-[0.2em] text-[#999] transition-colors hover:text-[#0a0a0a]"
							>
								hello@z8.app &rarr;
							</a>
						</div>
					</div>
					{/* Geometric decoration with image */}
					<div className="hidden items-center justify-center md:flex">
						<div className="relative h-72 w-72">
							<div
								className="absolute inset-0 overflow-hidden"
								style={{
									border: "3px solid #0a0a0a",
									transform: "rotate(45deg)",
								}}
							>
								<Image
									src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop"
									alt=""
									fill
									className="object-cover"
									style={{
										transform: "rotate(-45deg) scale(1.5)",
										filter: "grayscale(100%) contrast(1.2)",
									}}
								/>
							</div>
							<div
								className="absolute inset-8"
								style={{
									backgroundColor: "#2563eb",
									transform: "rotate(45deg)",
								}}
							/>
							<div
								className="absolute inset-16 rounded-full"
								style={{ border: "3px solid #0a0a0a" }}
							/>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="px-8 py-8 lg:px-16" style={{ borderTop: "2px solid #0a0a0a" }}>
				<div className="flex items-center justify-between">
					<span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#999]">
						&copy; 2025 Z8
					</span>
					<Link
						href="/"
						className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#999] transition-colors hover:text-[#2563eb]"
					>
						&larr; Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}

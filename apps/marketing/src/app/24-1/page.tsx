import Image from "next/image";
import Link from "next/link";

export default function Design24_1() {
	return (
		<div
			className="noise min-h-screen"
			style={{
				fontFamily: "'Playfair Display', 'Didot', 'Bodoni MT', Georgia, serif",
				backgroundColor: "#0c0c0f",
				color: "#d8d0c8",
			}}
		>
			{/* Melting chrome ambient */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 60% 40% at 20% 90%, rgba(200,180,140,0.06) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 80% 10%, rgba(200,200,220,0.04) 0%, transparent 50%), linear-gradient(180deg, rgba(12,12,15,0) 60%, rgba(180,160,120,0.03) 100%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-10 py-8 lg:px-20">
				<div className="flex items-baseline gap-5">
					<span
						className="text-[28px] font-light tracking-[0.05em]"
						style={{
							background: "linear-gradient(180deg, #e8e0d8, #a09080)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
					<span className="text-[9px] uppercase tracking-[0.5em] text-[#4a4540]">
						Schmelze
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[11px] tracking-[0.15em] text-[#5a5550] md:flex">
					<a href="#features" className="transition-colors hover:text-[#d8d0c8]">Funktionen</a>
					<a href="#essence" className="transition-colors hover:text-[#d8d0c8]">Essenz</a>
					<a href="#contact" className="transition-colors hover:text-[#d8d0c8]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="text-[9px] uppercase tracking-[0.3em] transition-all hover:text-[#d8d0c8]"
					style={{
						color: "#7a706a",
						borderBottom: "1px solid #7a706a40",
						paddingBottom: "3px",
					}}
				>
					Anfragen
				</a>
			</header>

			{/* Melting divider */}
			<div className="relative z-10 mx-10 lg:mx-20">
				<div
					className="h-px"
					style={{
						background: "linear-gradient(90deg, rgba(200,180,140,0.2), rgba(220,210,200,0.3) 30%, rgba(200,200,220,0.15) 60%, transparent)",
					}}
				/>
			</div>

			{/* Hero — asymmetric left-heavy */}
			<section className="relative z-10 px-10 pb-32 pt-28 lg:px-20">
				<div className="grid gap-8 lg:grid-cols-12">
					<div className="lg:col-span-8">
						<p
							className="animate-fade-up mb-10 text-[10px] uppercase tracking-[0.6em]"
							style={{ color: "#6a6058", animationDelay: "0.1s" }}
						>
							Wenn Metall flie&szlig;t
						</p>

						<h1
							className="animate-fade-up"
							style={{
								fontSize: "clamp(3.5rem, 10vw, 8rem)",
								fontWeight: 300,
								lineHeight: 0.92,
								letterSpacing: "-0.03em",
								animationDelay: "0.2s",
							}}
						>
							<span
								style={{
									background: "linear-gradient(180deg, #f0ece8 0%, #c0b8b0 30%, #a09888 60%, #806848 100%)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								Fl&uuml;ssig.
							</span>
							<br />
							<span
								style={{
									background: "linear-gradient(180deg, #c0b8b0 0%, #987858 50%, #685840 100%)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								Schmelzend.
							</span>
							<br />
							<span style={{ color: "#4a4038", fontStyle: "italic" }}>Unaufhaltsam.</span>
						</h1>

						<p
							className="animate-fade-up mt-12 max-w-lg text-[15px] leading-[2.1]"
							style={{
								color: "#6a6058",
								fontFamily: "'Gill Sans', 'Optima', 'Segoe UI', sans-serif",
								animationDelay: "0.4s",
							}}
						>
							Wenn Chrom schmilzt, nimmt es jede Form an. Z8 gie&szlig;t sich in
							Ihre Prozesse &mdash; nahtlos, GoBD-konform, unzerst&ouml;rbar geh&auml;rtet.
						</p>

						<div className="animate-fade-up mt-14 flex items-center gap-8" style={{ animationDelay: "0.5s" }}>
							<a
								href="#contact"
								className="group relative overflow-hidden px-10 py-4 text-[10px] font-semibold uppercase tracking-[0.2em]"
								style={{
									background: "linear-gradient(135deg, #c0b8a8, #e0d8c8, #a09080)",
									color: "#0c0c0f",
								}}
							>
								<span className="relative z-10">Demo anfragen</span>
								<div
									className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
									style={{ background: "linear-gradient(135deg, #e0d8c8, #f0ece8, #c0b8a8)" }}
								/>
							</a>
							<a href="#features" className="text-[10px] tracking-[0.2em] text-[#5a5550] transition-colors hover:text-[#d8d0c8]">
								Erkunden &darr;
							</a>
						</div>
					</div>

					{/* Right column — dripping image */}
					<div className="animate-scale-in relative lg:col-span-4" style={{ animationDelay: "0.3s" }}>
						<div className="relative h-[60vh] overflow-hidden" style={{ borderRadius: "0 0 50% 50% / 0 0 8% 8%" }}>
							<Image
								src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: "saturate(0.1) brightness(0.4) contrast(1.3) sepia(0.2)" }}
								priority
							/>
							{/* Melting gradient overlay */}
							<div
								className="absolute inset-0"
								style={{
									background: "linear-gradient(180deg, rgba(12,12,15,0.2) 0%, rgba(12,12,15,0) 40%, rgba(180,160,120,0.08) 80%, rgba(12,12,15,0.9) 100%)",
								}}
							/>
						</div>
						{/* Drip accents */}
						<div className="absolute -bottom-8 left-1/4 h-8 w-px" style={{ background: "linear-gradient(180deg, rgba(200,180,140,0.3), transparent)" }} />
						<div className="absolute -bottom-12 left-1/2 h-12 w-px" style={{ background: "linear-gradient(180deg, rgba(200,180,140,0.2), transparent)" }} />
						<div className="absolute -bottom-6 left-3/4 h-6 w-px" style={{ background: "linear-gradient(180deg, rgba(200,180,140,0.15), transparent)" }} />
					</div>
				</div>
			</section>

			{/* Features — staggered left-aligned */}
			<section id="features" className="relative z-10 px-10 py-24 lg:px-20">
				<div className="mb-16">
					<span className="mb-3 block text-[9px] uppercase tracking-[0.5em] text-[#6a6058]">
						Funktionen
					</span>
					<h2
						className="text-[clamp(2rem,4vw,3.5rem)] font-light tracking-tight"
						style={{
							background: "linear-gradient(180deg, #d8d0c8, #887868)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Sechs Sch&uuml;sse Metall.
					</h2>
				</div>

				<div className="grid gap-0">
					{[
						{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation \u00fcber alle Ger\u00e4te." },
						{ title: "GoBD-konform", desc: "Revisionssichere Eintr\u00e4ge. Unver\u00e4nderbar dokumentiert." },
						{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Nahtloser Transfer." },
						{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Organisationen isoliert und geh\u00e4rtet." },
						{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Verschmolzen mit Ihrer Infrastruktur." },
						{ title: "Echtzeit-Analyse", desc: "\u00dcberstunden, Trends, Dashboards. Sofort reflektiert." },
					].map((f, i) => (
						<div
							key={i}
							className="group grid items-baseline gap-8 py-7 transition-colors hover:bg-[#ffffff03] lg:grid-cols-12"
							style={{ borderBottom: "1px solid rgba(200,180,140,0.06)" }}
						>
							<span className="text-[10px] tracking-[0.3em] text-[#4a4038] lg:col-span-1">
								0{i + 1}
							</span>
							<h3 className="text-[20px] font-light tracking-tight transition-colors group-hover:text-[#e0d8c8] lg:col-span-4"
								style={{ color: "#a09888" }}
							>
								{f.title}
							</h3>
							<p className="text-[13px] leading-[1.9] text-[#5a5550] lg:col-span-7"
								style={{ fontFamily: "'Gill Sans', 'Optima', 'Segoe UI', sans-serif" }}
							>
								{f.desc}
							</p>
						</div>
					))}
				</div>
			</section>

			{/* Full-width melting image */}
			<section className="relative z-10 mx-10 mb-24 lg:mx-20">
				<div className="relative h-[30vh] overflow-hidden">
					<Image
						src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1400&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: "saturate(0.05) brightness(0.35) contrast(1.2) sepia(0.15)" }}
					/>
					<div
						className="absolute inset-0"
						style={{
							background: "linear-gradient(180deg, rgba(12,12,15,0.6) 0%, rgba(12,12,15,0) 30%, rgba(12,12,15,0) 70%, rgba(12,12,15,0.8) 100%)",
						}}
					/>
					{/* Pooling chrome at bottom */}
					<div
						className="absolute bottom-0 left-0 right-0 h-1"
						style={{
							background: "linear-gradient(90deg, transparent 5%, rgba(200,180,140,0.4) 20%, rgba(220,210,200,0.6) 50%, rgba(200,180,140,0.4) 80%, transparent 95%)",
						}}
					/>
				</div>
			</section>

			{/* Essence */}
			<section id="essence" className="relative z-10 px-10 py-32 lg:px-20">
				<div className="max-w-2xl">
					<div className="mb-8 flex items-center gap-4">
						<div className="h-12 w-px" style={{ background: "linear-gradient(180deg, rgba(200,180,140,0.3), transparent)" }} />
					</div>
					<blockquote
						className="text-[clamp(1.5rem,3.5vw,2.8rem)] font-light leading-[1.4] tracking-[-0.01em]"
						style={{
							background: "linear-gradient(135deg, #d8d0c8, #887868)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Was schmilzt, kann neu geformt werden.
						Was geh&auml;rtet wird, h&auml;lt ewig.
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-10 py-24 lg:px-20">
				<div className="grid gap-12 lg:grid-cols-2">
					<div>
						<h2
							className="text-[clamp(2rem,5vw,4rem)] font-light leading-[1.1] tracking-tight"
							style={{
								background: "linear-gradient(180deg, #e0d8c8, #806848)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							Bereit zum
							<br />
							Gie&szlig;en?
						</h2>
					</div>
					<div className="flex flex-col justify-end">
						<p
							className="mb-8 text-[14px] leading-[2] text-[#6a6058]"
							style={{ fontFamily: "'Gill Sans', 'Optima', 'Segoe UI', sans-serif" }}
						>
							Wir formen Z8 nach Ihren Anforderungen. Pers&ouml;nlich. Pr&auml;zise.
						</p>
						<div className="flex items-center gap-6">
							<a
								href="mailto:hello@z8.app"
								className="px-10 py-4 text-[10px] font-semibold uppercase tracking-[0.2em] transition-all hover:shadow-[0_0_30px_rgba(200,180,140,0.1)]"
								style={{
									background: "linear-gradient(135deg, #c0b8a8, #e0d8c8, #a09080)",
									color: "#0c0c0f",
								}}
							>
								Demo vereinbaren
							</a>
							<a href="mailto:hello@z8.app" className="text-[11px] tracking-[0.1em] text-[#5a5550] transition-colors hover:text-[#d8d0c8]">
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-10 py-8 lg:px-20">
				<div className="h-px" style={{ background: "linear-gradient(90deg, rgba(200,180,140,0.1), transparent 80%)" }} />
				<div className="flex items-center justify-between pt-6 text-[9px] uppercase tracking-[0.3em] text-[#3a3530]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#d8d0c8]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}

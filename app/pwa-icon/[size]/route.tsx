import { ImageResponse } from "next/og";

// Paper and Lamplight versions of the same mark (matches the --paper / --margin / --accent tokens).
const PALETTE = {
  light: { bg: "#efeadc", margin: "#c98474", rule: "rgba(70,55,30,0.18)", check: "#2d3f5e" },
  dark: { bg: "#1b1612", margin: "#b8704f", rule: "rgba(236,225,204,0.14)", check: "#e3b25f" },
};

// A ruled page with a margin line and one ink check. Rendered on demand at any size; ?theme=dark for Lamplight.
export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const n = Math.min(1024, Math.max(32, parseInt((await params).size, 10) || 192));
  const c = new URL(req.url).searchParams.get("theme") === "dark" ? PALETTE.dark : PALETTE.light;
  return new ImageResponse(
    (
      <div style={{ width: n, height: n, display: "flex", background: c.bg, position: "relative" }}>
        <div style={{ position: "absolute", left: n * 0.3, top: 0, bottom: 0, width: Math.max(2, n * 0.012), background: c.margin }} />
        {[0.28, 0.46, 0.64, 0.82].map((y) => (
          <div key={y} style={{ position: "absolute", left: 0, right: 0, top: n * y, height: Math.max(1, n * 0.006), background: c.rule }} />
        ))}
        <svg width={n} height={n} viewBox="0 0 100 100" style={{ position: "absolute", left: 0, top: 0 }}>
          <path d="M40 52 L51 63 L76 33" fill="none" stroke={c.check} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { width: n, height: n },
  );
}

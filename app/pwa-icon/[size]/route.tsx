import { ImageResponse } from "next/og";

// A ruled page with a margin line and one ink check. Rendered on demand at any size.
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const n = Math.min(1024, Math.max(32, parseInt((await params).size, 10) || 192));
  return new ImageResponse(
    (
      <div style={{ width: n, height: n, display: "flex", background: "#efeadc", position: "relative" }}>
        <div style={{ position: "absolute", left: n * 0.3, top: 0, bottom: 0, width: Math.max(2, n * 0.012), background: "#c98474" }} />
        {[0.28, 0.46, 0.64, 0.82].map((y) => (
          <div key={y} style={{ position: "absolute", left: 0, right: 0, top: n * y, height: Math.max(1, n * 0.006), background: "rgba(70,55,30,0.18)" }} />
        ))}
        <svg width={n} height={n} viewBox="0 0 100 100" style={{ position: "absolute", left: 0, top: 0 }}>
          <path d="M40 52 L51 63 L76 33" fill="none" stroke="#2d3f5e" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { width: n, height: n },
  );
}

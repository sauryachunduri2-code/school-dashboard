import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const display = Newsreader({
  subsets: ["latin"],
  variable: "--f-display",
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});
const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--f-body", display: "swap" });

export const metadata: Metadata = {
  title: { default: "School Dashboard", template: "%s · School Dashboard" },
  description: "Tasks, calendar and EC hours in one place.",
  appleWebApp: { capable: true, title: "Dashboard", statusBarStyle: "black-translucent" },
  icons: { apple: "/pwa-icon/180", icon: "/pwa-icon/192" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efeadc" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1612" },
  ],
};

// Runs before first paint so the saved theme never flashes the wrong palette.
const themeScript = `try{var t=localStorage.getItem('sd-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "School Dashboard",
    short_name: "Dashboard",
    description: "Tasks, calendar and EC hours in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#efeadc",
    theme_color: "#efeadc",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

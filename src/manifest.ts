export const manifest = {
  name: "Tabata Timer",
  short_name: "Tabata",
  description: "A single-screen Tabata and interval timer that works offline.",
  start_url: "/",
  scope: "/",
  display: "standalone" as const,
  orientation: "portrait" as const,
  theme_color: "#12355b",
  background_color: "#f6f7f9",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

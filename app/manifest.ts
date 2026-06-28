import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "你和你",
    short_name: "Ego",
    description: "一个像朋友一样和你聊天的 AI。",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f4ef",
    theme_color: "#f7f4ef",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}

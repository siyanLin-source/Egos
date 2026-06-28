import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "你和你",
  title: "你和你",
  description: "一个像朋友一样和你聊天的 AI。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Ego",
    statusBarStyle: "default",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f4ef",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}

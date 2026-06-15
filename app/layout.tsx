import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "你和你",
  description: "一个像朋友一样和你聊天的 AI。",
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

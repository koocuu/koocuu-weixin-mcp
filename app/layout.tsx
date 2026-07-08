import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Koocuu Weixin MCP",
  description: "Remote MCP server for WeChat Official Account operations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

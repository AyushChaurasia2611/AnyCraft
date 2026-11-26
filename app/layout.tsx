import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AnyCraft — Ultra-Fast Remote Desktop & Mobile Share",
  description:
    "Low-latency WebRTC peer-to-peer remote desktop and mobile screen sharing built with Next.js.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AnyCraft",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh bg-[#09090b] text-zinc-100 font-sans antialiased selection:bg-red-500/30 selection:text-red-200">
        {children}
      </body>
    </html>
  );
}

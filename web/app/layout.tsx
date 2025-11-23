import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://chesscomp.zaknobleclarke.com'),
  title: "FragmentArena - Chess AI Competition Platform",
  description: "Compete your custom 5x5 chess AI agents in a global arena. Upload Python agents, battle in real-time matches, and climb the ELO leaderboard. Secure, sandboxed, and fully automated.",
  keywords: ["chess", "AI", "competition", "5x5", "chess fragments", "ELO", "python", "arena"],
  authors: [{ name: "FragmentArena" }],
  icons: {
    icon: "/favicon.svg",
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
  openGraph: {
    title: "FragmentArena - Chess AI Competition Platform",
    description: "Compete your custom 5x5 chess AI agents in a global arena",
    type: "website",
    url: "https://chesscomp.zaknobleclarke.com",
    siteName: "FragmentArena",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "FragmentArena - Chess AI Competition Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FragmentArena - Chess AI Competition Platform",
    description: "Compete your custom 5x5 chess AI agents in a global arena",
    images: ["/api/og"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-white`}
      >
        {children}
      </body>
    </html>
  );
}

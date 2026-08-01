import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "HyperEdge";
const description =
  "Rule-based edge discovery with walk-forward validation across Hyperliquid crypto and HIP-3 perpetual markets.";
const themeScript = `
  try {
    const stored = localStorage.getItem("hyperedge-theme-v1");
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
    }
  } catch {}
`;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const requestedHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const host = /^[a-z0-9.-]+(?::\d+)?$/i.test(requestedHost)
    ? requestedHost
    : "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  return {
    metadataBase: baseUrl,
    title: {
      default: title,
      template: "%s | HyperEdge",
    },
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}

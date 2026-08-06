import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const siteUrl = "https://compass-globe.vercel.app";
const socialDescription =
  "Open-source geolocation triage for video evidence. Extract keyframes locally, turn visible clues into auditable leads, and plot candidate regions on a globe.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Compass Globe — open-source geolocation triage for video evidence",
    template: "%s | Compass Globe",
  },
  description: socialDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Compass Globe",
    description: socialDescription,
    type: "website",
    url: "/",
    siteName: "Compass Globe",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Compass Globe — open-source geolocation triage for video evidence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Compass Globe",
    description: socialDescription,
    images: [
      {
        url: "/og-image.png",
        alt: "Compass Globe — open-source geolocation triage for video evidence",
      },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=clash-display@600,700&f[]=satoshi@400,500,700&display=swap"
          rel="stylesheet"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23FF5A1F'/%3E%3Cpath d='M23 8 17.6 17.6 8 23l5.4-9.6z' fill='%23000'/%3E%3C/svg%3E"
        />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}

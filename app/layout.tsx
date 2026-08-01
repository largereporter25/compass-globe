import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Compass Globe — open-source geolocation triage for video evidence",
  description:
    "Drop a video. Keyframes are extracted and read in your browser, on-screen text is turned into auditable location clues, and candidate regions are plotted on a globe with the reasoning attached. Open geodata only. No Google, no Bing, no paid vision APIs.",
  openGraph: {
    title: "Compass Globe",
    description:
      "Geolocation triage for video evidence. Local keyframe extraction and OCR, open geodata, and a reasoning trail you can audit.",
    type: "website",
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
      <body>{children}</body>
    </html>
  );
}

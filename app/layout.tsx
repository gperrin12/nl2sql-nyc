import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Providers } from "./providers";

// Terminal/monospace face — Claude Code feel. Drives both UI and code.
const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-dos",
});

export const metadata: Metadata = {
  title: "NL → SQL: NYC Civic Data",
  description: "Ask natural-language questions over NYC TLC, 311, crashes, and census data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}

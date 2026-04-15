import type { Metadata } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import "@/styles/globals.css";
import { Web3Provider } from "@/providers/Web3Provider";

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DealRoom",
  description: "AI-powered OTC deal negotiation and execution",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${ibmPlexMono.variable} ${sora.variable}`}>
      <body>
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}

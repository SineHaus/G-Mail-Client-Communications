import type { Metadata, Viewport } from "next";
import { Archivo, Big_Shoulders, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Type follows the TERG logo: Big Shoulders for stencil-style headings, Archivo to read, JetBrains Mono
// for numbers and labels.
const display = Big_Shoulders({ variable: "--font-big-shoulders", subsets: ["latin"], weight: ["600", "700", "800", "900"] });
const body = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Client Communications · The Event Rental Guys",
  description: "Client email, Claude-drafted replies, quotes and clients in one place.",
  icons: { icon: "/brand/terg-tent.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ece8df" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0b14" },
  ],
};

// Light, Dark or Auto (follows the device). Set before the page paints so it never flashes.
const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("terg-theme")||"auto";var m=window.matchMedia("(prefers-color-scheme: dark)");var a=function(){var d=p==="dark"||(p==="auto"&&m.matches);document.documentElement.dataset.theme=d?"dark":"light";};a();m.addEventListener("change",function(){p=localStorage.getItem("terg-theme")||"auto";a();});}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}

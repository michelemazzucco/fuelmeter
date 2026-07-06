import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  JetBrains_Mono,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppNav } from "@/components/app-nav";
import { AuthProvider } from "@/components/auth-provider";
import { isAuthenticated } from "@/lib/auth";

const spaceGroteskHeading = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FuelMeter",
  description: "Track and predict your diesel tank level",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const authed = await isAuthenticated();
  return (
    <html
      lang="en"
      className={cn(
        "h-full antialiased",
        geistSans.variable,
        geistMono.variable,
        jetbrainsMono.variable,
        spaceGroteskHeading.variable,
      )}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AuthProvider isAuthenticated={authed}>
          <AppNav />
          <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}

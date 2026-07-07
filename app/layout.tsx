import type { Metadata } from "next";
import { Ubuntu_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { isAuthenticated } from "@/lib/auth";
import { AuthProvider } from "@/components/auth-provider";
import { AppNav } from "@/components/app-nav";

const ubuntuMono = Ubuntu_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
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
    <html lang="en" className={cn("h-full antialiased", ubuntuMono.variable)}>
      <body className="min-h-full flex flex-col bg-background text-foreground px-1 lg:px-0">
        <AuthProvider isAuthenticated={authed}>
          <AppNav />
          <main className="flex-1 w-full mx-auto px-2 pb-8 pt-6 max-w-5xl">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}

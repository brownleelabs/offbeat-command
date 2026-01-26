import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DashboardProvider } from "@/components/dashboard-context";
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
  title: "Campus Mobility Project Control Center",
  description: "Token yield map",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} h-screen min-h-screen bg-black text-emerald-400 antialiased`}
      >
        <DashboardProvider>
          {children}
        </DashboardProvider>
      </body>
    </html>
  );
}

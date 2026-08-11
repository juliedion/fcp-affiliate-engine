import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Fort Crazypants OS", description: "AI-powered ecommerce merchandising system" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

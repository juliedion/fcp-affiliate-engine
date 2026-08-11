"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);
  return <div className="shell"><aside className="sidebar"><div className="brand">FORT <span>CRAZYPANTS</span></div><div className="tagline">Deals, steals & smart reveals</div><nav className="nav">
    <Link className={isActive("/") ? "active" : ""} href="/">✦ Product Studio</Link>
    <Link className={isActive("/products") ? "active" : ""} href="/products">▦ Saved Products</Link>
    <Link className={isActive("/winning-products") ? "active" : ""} href="/winning-products">🔥 Winning Products</Link>
    <Link className={isActive("/settings") ? "active" : ""} href="/settings">⚙ Settings</Link>
    <a href="#integrations">⚡ Integrations</a>
  </nav></aside><main className="main">{children}</main></div>;
}

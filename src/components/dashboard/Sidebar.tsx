"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarProps {
  tenantSlug: string;
  tenantName: string;
}

export function Sidebar({ tenantSlug, tenantName }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { label: "Genel Bakış", href: `/dashboard/${tenantSlug}`, icon: "🏠", exact: true },
    { label: "Katalog & XML/API Feed", href: `/dashboard/${tenantSlug}/catalog`, icon: "📦" },
    { label: "AI Stilist & Kurallar", href: `/dashboard/${tenantSlug}/persona`, icon: "🧠" },
    { label: "Görsel Tasarım & Canlı Test", href: `/dashboard/${tenantSlug}/design`, icon: "🎨" },
    { label: "Entegrasyon & Script Kodu", href: `/dashboard/${tenantSlug}/integration`, icon: "🔌" },
    { label: "Analitik & Raporlama", href: `/dashboard/${tenantSlug}/analytics`, icon: "📊" },
  ];

  return (
    <aside className="dashboard-sidebar">
      <div className="sidebar-brand-badge">
        <div className="brand-avatar">{tenantName.slice(0, 2).toUpperCase()}</div>
        <div className="brand-meta">
          <span className="brand-name">{tenantName}</span>
          <span className="brand-slug">{tenantSlug}</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive ? "active" : ""}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="doc-card">
          <h4>💡 Hızlı İpucu</h4>
          <p>Yaptığınız tüm değişiklikler anında widget'a yansır, kod derlemeye gerek yoktur.</p>
        </div>
      </div>
    </aside>
  );
}

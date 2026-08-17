"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Tenant } from "@/lib/tenant/types";

interface HeaderProps {
  tenants: Tenant[];
  currentTenant?: Tenant;
}

export function Header({ tenants, currentTenant }: HeaderProps) {
  const router = useRouter();

  return (
    <header className="dashboard-header">
      <div className="header-left">
        <Link href="/dashboard" className="header-logo">
          <span className="logo-badge">ROVENA</span>
          <span className="logo-sub">Merchant Portal</span>
        </Link>

        {tenants.length > 0 && (
          <div className="tenant-switcher">
            <label htmlFor="tenant-select" className="sr-only">Marka Seç:</label>
            <select
              id="tenant-select"
              value={currentTenant?.slug || ""}
              onChange={(e) => {
                if (e.target.value) {
                  router.push(`/dashboard/${e.target.value}`);
                } else {
                  router.push("/dashboard");
                }
              }}
              className="tenant-select"
            >
              <option value="">Tüm Markalar (Genel Bakış)</option>
              {tenants.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name} ({t.slug})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="header-right">
        {currentTenant && (
          <>
            <span className={`status-pill status-${currentTenant.status || "active"}`}>
              ● {currentTenant.status === "active" ? "Aktif" : currentTenant.status === "trial" ? "Deneme" : "Duraklatıldı"}
            </span>
            <a
              href={`/demo/${currentTenant.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-header-action"
            >
              Vitrin Demosu ↗
            </a>
          </>
        )}
      </div>
    </header>
  );
}

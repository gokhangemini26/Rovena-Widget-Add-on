import "./dashboard.css";
import { listAllTenants } from "@/lib/tenant/resolve";
import { Header } from "@/components/dashboard/Header";

export const metadata = {
  title: "Rovena Merchant Portal — AI Stylist Dashboard",
  description: "Marka AI Stilist entegrasyonu ve katalog kontrol paneli",
};

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenants = await listAllTenants();

  return (
    <div className="dashboard-root">
      <Header tenants={tenants} />
      <div className="dashboard-body">{children}</div>
    </div>
  );
}

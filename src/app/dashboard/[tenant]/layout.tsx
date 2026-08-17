import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant/resolve";
import { Sidebar } from "@/components/dashboard/Sidebar";

export const dynamic = "force-dynamic";

export default async function TenantDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const tenant = await getTenant(slug);

  if (!tenant) {
    notFound();
  }

  return (
    <div style={{ display: "flex", flex: 1, width: "100%" }}>
      <Sidebar tenantSlug={tenant.slug} tenantName={tenant.name} />
      <div style={{ flex: 1, overflowY: "auto" }}>{children}</div>
    </div>
  );
}

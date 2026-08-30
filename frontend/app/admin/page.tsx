import { AppShell } from "@/components/app-shell";
import { AdminPage } from "@/components/pages/admin-page";

export const metadata = { title: "Users | CNC Research Console" };

export default function Page() {
  return (
    <AppShell title="User management">
      <AdminPage />
    </AppShell>
  );
}

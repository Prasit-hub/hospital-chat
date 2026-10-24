import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Sidebar me={{ id: user.id, name: user.name, email: user.email, role: user.role, color: user.color, authSource: user.authSource, adUsername: user.adUsername ?? undefined }} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-14 md:pb-0">{children}</main>
    </div>
  );
}

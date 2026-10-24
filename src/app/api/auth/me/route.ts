import { currentUser } from "@/lib/auth";
import { handle, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const u = await currentUser();
  return json({ id: u.id, name: u.name, email: u.email, role: u.role, color: u.color, authSource: u.authSource, adUsername: u.adUsername ?? undefined });
});

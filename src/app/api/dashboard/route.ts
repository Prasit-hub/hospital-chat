import { handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { dashboard, type Range } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const me = await currentUser();
  const r = new URL(req.url).searchParams.get("range");
  const range: Range = r === "7d" || r === "30d" ? r : "today";
  return json(await dashboard(me.orgId, range));
});

import { agentHeaders, agentUrl } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function POST() {
  const upstream = await fetch(agentUrl("/api/stop"), {
    method: "POST",
    headers: agentHeaders(),
    cache: "no-store",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

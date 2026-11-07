import { agentHeaders, agentUrl } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  const headers = agentHeaders();
  headers.set("content-type", "application/json");
  const upstream = await fetch(agentUrl("/api/messages"), {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

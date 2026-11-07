import { agentHeaders, agentUrl } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const upstream = await fetch(agentUrl("/api/events"), {
    headers: agentHeaders(),
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return Response.json(
      { error: detail || upstream.statusText },
      { status: upstream.status || 502 },
    );
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}

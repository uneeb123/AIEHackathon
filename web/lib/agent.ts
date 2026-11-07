const base = () => process.env.PI_AGENT_URL ?? "http://127.0.0.1:8000";

export function agentUrl(path: string) {
  const root = base().replace(/\/$/, "");
  return `${root}${path}`;
}

export function agentHeaders(): Headers {
  const headers = new Headers();
  const token = process.env.PI_AGENT_TOKEN;
  if (!token) return headers;
  if (base().includes(".exe.xyz")) {
    headers.set("X-Exedev-Authorization", `Bearer ${token}`);
  } else {
    headers.set("authorization", `Bearer ${token}`);
  }
  return headers;
}

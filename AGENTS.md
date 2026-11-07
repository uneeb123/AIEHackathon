# Stack

- `agent/` is a Pi Durable 1.3 process. It runs on an exe.dev VM and calls OpenRouter. Do not put an OpenRouter key in the Vercel app.
- `web/` is the Next.js frontend: Assistant UI and shadcn. Vercel hosts this directory. The Vercel project does not exist yet; do not link or deploy until asked. When it is created, set the project root to `web`.
- The browser talks only to `web`. `web` proxies to the agent with `PI_AGENT_URL` and `PI_AGENT_TOKEN`.
- For an `*.exe.xyz` URL, `PI_AGENT_TOKEN` is an exe.dev VM HTTPS token and is sent as `X-Exedev-Authorization`. Locally it is `AGENT_TOKEN` from `agent/agent.env`, sent as `Authorization`.
- Prefer an exe.dev LLM integration (`OPENROUTER_BASE_URL`) so the OpenRouter key stays off the VM. Direct `OPENROUTER_API_KEY` is for local runs.
- The VM needs Node.js 24 or newer. Install `agent/pi-durable.service` there. Keep the VM private.

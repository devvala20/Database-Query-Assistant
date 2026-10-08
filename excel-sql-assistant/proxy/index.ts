/**
 * proxy/index.ts — Backend Proxy (Phase 4)
 *
 * A thin Cloudflare Worker that:
 *   1. Receives { systemPrompt, question, schema, history, options } from the add-in
 *   2. Adds the Claude API key (stored in Worker secrets, never in client code)
 *   3. Applies rate limiting per user/session
 *   4. Calls the Claude API and streams or returns the JSON response
 *   5. Never logs row data (only logs question length and schema size for debugging)
 *
 * Deploy: `wrangler deploy` from this directory.
 * Set secret: `wrangler secret put ANTHROPIC_API_KEY`
 *
 * To use Azure Functions instead:
 *   - Rename to index.ts in an HttpTrigger function
 *   - Replace `export default { fetch }` with the Azure Function handler
 *   - Store the key in Azure Key Vault / App Settings
 */

interface Env {
  ANTHROPIC_API_KEY: string;
  /** Comma-separated list of allowed origin domains, e.g. "https://my-addin.vercel.app" */
  ALLOWED_ORIGINS: string;
  /** Optional secret auth token for user / tenant authentication */
  PROXY_AUTH_TOKEN?: string;
}

// ─── Rate limiting ─────────────────────────────────────────────────────────────
// Simple in-memory per-IP rate limit. For production, use Cloudflare KV or
// Durable Objects for persistence across Worker instances.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_RPM = 20; // requests per minute per IP
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_RPM;
}

// ─── Request / Response types ─────────────────────────────────────────────────

interface ProxyRequest {
  systemPrompt: string;
  question: string;
  schema: string;
  history: Array<{ role: string; content: string }>;
  repair?: { failedSql: string; errorMessage: string };
  options?: { sampleValues?: Record<string, string[]> };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS pre-flight
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const origin = request.headers.get("Origin") ?? "";
    const corsOrigin =
      allowedOrigins.length === 0 || allowedOrigins.includes(origin)
        ? origin
        : allowedOrigins[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    // Optional Tenant / User Authentication (Phase 8)
    if (env.PROXY_AUTH_TOKEN) {
      const authHeader = request.headers.get("Authorization") ?? "";
      const expected = `Bearer ${env.PROXY_AUTH_TOKEN}`;
      if (authHeader !== expected) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Invalid or missing bearer token." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Rate limiting
    const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please wait a moment." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse body
    let body: ProxyRequest;
    try {
      body = await request.json() as ProxyRequest;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate required fields
    if (!body.question || !body.schema) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: question, schema." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Size guard — prevent abuse via huge schemas
    const bodyStr = JSON.stringify(body);
    if (bodyStr.length > 100_000) {
      return new Response(
        JSON.stringify({ error: "Request payload too large (max 100 KB)." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Claude message list
    const messages: Array<{ role: string; content: string }> = [
      // Schema as a "context" user message
      {
        role: "user",
        content: `Available tables:\n\n${body.schema}`,
      },
      {
        role: "assistant",
        content: "Understood. I'll generate DuckDB SQL using only these tables and columns.",
      },
      // Prior conversation turns
      ...(body.history ?? []),
      // Current question
      {
        role: "user",
        content: body.repair
          ? `The following SQL query failed:\n\`\`\`sql\n${body.repair.failedSql}\n\`\`\`\nError: ${body.repair.errorMessage}\n\nPlease fix it. Original question: ${body.question}`
          : body.question,
      },
    ];

    // Call Claude API
    try {
      const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1024,
          system: body.systemPrompt,
          messages,
        }),
      });

      if (!claudeResponse.ok) {
        const errText = await claudeResponse.text();
        console.error(`[Proxy] Claude API error ${claudeResponse.status}:`, errText);
        return new Response(
          JSON.stringify({ error: `AI service error: ${claudeResponse.status}` }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const claudeJson = await claudeResponse.json() as {
        content: Array<{ type: string; text: string }>;
      };

      const rawText = claudeJson.content.find((b) => b.type === "text")?.text ?? "";

      // Parse the JSON from Claude's response
      let parsed: unknown;
      try {
        // Claude sometimes wraps JSON in ```json ... ``` — strip that
        const cleaned = rawText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("[Proxy] Failed to parse Claude JSON:", rawText.slice(0, 500));
        return new Response(
          JSON.stringify({
            error: "AI returned malformed JSON. Please try again.",
            rawResponse: rawText.slice(0, 200),
          }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Log only non-sensitive metadata (never log question content or schema values)
      console.log(
        `[Proxy] OK — questionLen=${body.question.length} schemaLen=${body.schema.length}`
      );

      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[Proxy] Unexpected error:", err);
      return new Response(
        JSON.stringify({ error: "Internal server error." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};

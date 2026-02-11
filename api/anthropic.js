function isAllowedOrigin(origin) {
  if (origin === "https://tals-dotcom.github.io") return true;
  if (origin.endsWith(".vercel.app") && origin.startsWith("https://")) return true;
  return false;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  // Only allow POST
  if (req.method !== "POST") {
    res.writeHead(405, { ...corsHeaders(origin), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // Origin check
  if (origin && !isAllowedOrigin(origin)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden origin" }));
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[proxy] OPENROUTER_API_KEY is not set");
    res.writeHead(500, { ...corsHeaders(origin), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }));
    return;
  }

  try {
    const { model, max_tokens, messages } = req.body;

    console.log("[proxy] Incoming request:", JSON.stringify({
      model,
      max_tokens,
      messageCount: messages?.length,
      firstMessageRole: messages?.[0]?.role,
      firstMessageLength: messages?.[0]?.content?.length,
    }));

    if (!messages || !Array.isArray(messages)) {
      console.error("[proxy] Invalid messages field:", typeof messages);
      res.writeHead(400, { ...corsHeaders(origin), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing or invalid 'messages' field" }));
      return;
    }

    const openRouterBody = {
      model: model || "anthropic/claude-sonnet-4",
      max_tokens: max_tokens || 6000,
      messages,
      stream: true,
    };

    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openRouterBody),
    });

    console.log("[proxy] OpenRouter status:", openRouterRes.status);

    // If OpenRouter returns an error (non-2xx), read as JSON and forward
    if (!openRouterRes.ok) {
      const rawBody = await openRouterRes.text();
      console.error("[proxy] OpenRouter error:", rawBody.substring(0, 1000));
      let errorData;
      try {
        errorData = JSON.parse(rawBody);
      } catch {
        errorData = { error: "OpenRouter returned non-JSON error", body: rawBody.substring(0, 500) };
      }
      res.writeHead(openRouterRes.status, {
        ...corsHeaders(origin),
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(errorData));
      return;
    }

    // Stream the SSE response back to the client
    res.writeHead(200, {
      ...corsHeaders(origin),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const reader = openRouterRes.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    } catch (streamErr) {
      console.error("[proxy] Stream read error:", streamErr.message);
    }

    res.end();

  } catch (err) {
    console.error("[proxy] Proxy exception:", err.message, err.stack);
    res.writeHead(502, { ...corsHeaders(origin), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Proxy error: " + err.message }));
  }
}

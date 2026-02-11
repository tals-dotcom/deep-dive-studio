const ALLOWED_ORIGIN = "https://tals-dotcom.github.io";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "",
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
  if (origin && origin !== ALLOWED_ORIGIN) {
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
      model: model || "anthropic/claude-sonnet-4-20250514",
      max_tokens: max_tokens || 6000,
      messages,
    };

    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openRouterBody),
    });

    const data = await openRouterRes.json();

    console.log("[proxy] OpenRouter response:", JSON.stringify({
      status: openRouterRes.status,
      hasChoices: !!data.choices,
      choicesLength: data.choices?.length,
      error: data.error,
      contentLength: data.choices?.[0]?.message?.content?.length,
    }));

    if (!openRouterRes.ok) {
      console.error("[proxy] OpenRouter error response:", JSON.stringify(data));
    }

    res.writeHead(openRouterRes.status, {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error("[proxy] Proxy exception:", err.message, err.stack);
    res.writeHead(502, { ...corsHeaders(origin), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Proxy error: " + err.message }));
  }
}

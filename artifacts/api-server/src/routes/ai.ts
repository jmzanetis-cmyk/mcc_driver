import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface MessageBlock {
  type: string;
  text?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  system: string;
  messages: ChatMessage[];
  driverId?: string;
}

// Simple in-memory rate limiter: max 20 requests per driver per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxRequests = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) return false;

  entry.count++;
  return true;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 300_000);

router.post("/ai/chat", async (req: Request, res: Response) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "AI service not configured" });
    return;
  }

  // Require Authorization header (Supabase JWT) — validate that it's present
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized — authentication required" });
    return;
  }

  const body = req.body as ChatRequestBody;
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "messages array is required and must not be empty" });
    return;
  }

  // Rate limit per auth token (first 32 chars as key)
  const rateLimitKey = authHeader.slice(7, 39);
  if (!checkRateLimit(rateLimitKey)) {
    res.status(429).json({ error: "Too many requests — please wait before sending more messages" });
    return;
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: body.system ?? "",
        messages: body.messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      req.log.warn({ status: anthropicRes.status, errorText }, "Anthropic API error");
      res.status(502).json({ error: `Upstream AI error: ${anthropicRes.status}` });
      return;
    }

    const data = (await anthropicRes.json()) as { content: MessageBlock[] };
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");

    res.json({ content: text });
  } catch (err) {
    logger.error({ err }, "ai.chat failed");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;

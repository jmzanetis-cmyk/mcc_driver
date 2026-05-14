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
}

interface SupabaseUser {
  id: string;
  email?: string;
  phone?: string;
}

// ── Supabase JWT verification ─────────────────────────────────────────────────
// Calls /auth/v1/user with the bearer token — Supabase validates signature,
// expiry, and audience server-side. Returns the user on success, null on failure.
async function verifySupabaseToken(token: string): Promise<SupabaseUser | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    logger.warn("VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — cannot verify JWT");
    return null;
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });

    if (!res.ok) return null;

    const user = (await res.json()) as SupabaseUser;
    if (!user?.id) return null;
    return user;
  } catch {
    return null;
  }
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Max 20 requests per authenticated user per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string, maxRequests = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

// Prune stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 300_000);

// ── Route ─────────────────────────────────────────────────────────────────────
router.post("/ai/chat", async (req: Request, res: Response) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "AI service not configured" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized — authentication required" });
    return;
  }

  const token = authHeader.slice(7);

  // Verify the token is a valid, non-expired Supabase JWT
  const user = await verifySupabaseToken(token);
  if (!user) {
    res.status(401).json({ error: "Unauthorized — invalid or expired token" });
    return;
  }

  const body = req.body as ChatRequestBody;
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "messages array is required and must not be empty" });
    return;
  }

  // Rate limit keyed on the verified user ID (not token substring)
  if (!checkRateLimit(user.id)) {
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

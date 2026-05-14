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

router.post("/ai/chat", async (req: Request, res: Response) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "AI service not configured" });
    return;
  }

  const body = req.body as ChatRequestBody;
  if (!body.messages || !Array.isArray(body.messages)) {
    res.status(400).json({ error: "messages array is required" });
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

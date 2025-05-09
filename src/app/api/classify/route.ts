// src/app/api/classify/route.ts
import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const taskCategories = [
  "Writing / Content Creation",
  "Coding / Development",
  "Instruction / Learning",
  "Research / Information Retrieval",
  "Creative Generation",
  "Conversation / Chat",
  "Data Analysis",
  "Multimodal (Image / Audio) Tasks",
];

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    console.error("Invalid JSON payload:", err);
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  try {
    // ── 1) Classification branch ───────────────────────────────
    if (typeof body.prompt === "string") {
      const { prompt } = body;
      const systemPrompt = `
You are a task classification assistant. Your job is to read a user's prompt and assign it one of these 8 categories only:

${taskCategories.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Return ONLY the name of the matching category. Do not explain your reasoning.
`;
      const completion = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      });
      const category =
        completion.choices[0]?.message?.content?.trim() ?? "Unknown";
      return NextResponse.json({ category });
    }

    // ── 2) General chat branch ────────────────────────────────
    if (Array.isArray(body.messages)) {
      // Normalize roles: frontend may use "ai", we need "assistant"
      const normalized = body.messages.map((m: any) => ({
        role:
          m.role === "ai"
            ? "assistant"
            : m.role === "assistant"
            ? "assistant"
            : m.role === "user"
            ? "user"
            : /* fallback, treat unknown as user */ "user",
        content: m.content,
      }));

      // Optionally prepend your own system prompt
      const full = [
        { role: "system", content: "You are a helpful AI assistant." },
        ...normalized,
      ];

      const completion = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: full,
      });
      const text = completion.choices[0]?.message?.content ?? "";
      return NextResponse.json({ text });
    }

    // ── 3) Neither prompt nor messages ────────────────────────
    return NextResponse.json(
      { error: "Must provide either { prompt } or { messages }" },
      { status: 400 }
    );
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

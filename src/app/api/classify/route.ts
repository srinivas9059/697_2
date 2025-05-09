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

// A simple keyword-based fallback
function fallbackClassifier(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/\b(code|script|program)\b/.test(p)) return "Coding / Development";
  if (/\b(summarize|write|create)\b/.test(p))
    return "Writing / Content Creation";
  if (/\b(learn|teach|explain)\b/.test(p)) return "Instruction / Learning";
  if (/\b(research|what is|information)\b/.test(p))
    return "Research / Information Retrieval";
  if (/\b(generate|creative|design)\b/.test(p)) return "Creative Generation";
  if (/\b(chat|talk|converse)\b/.test(p)) return "Conversation / Chat";
  if (/\b(data|analy(s|z)e)\b/.test(p)) return "Data Analysis";
  if (/\b(image|photo|audio|video)\b/.test(p))
    return "Multimodal (Image / Audio) Tasks";
  return "Writing / Content Creation";
}

async function tryGroqCall(payload: any) {
  const maxRetries = 3;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await groq.chat.completions.create(payload);
    } catch (err: any) {
      lastErr = err;
      // if it's not a 503, break immediately
      if (err.status !== 503) break;
      // otherwise wait a bit and retry
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }
  throw lastErr;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  // Classification branch
  if (typeof body.prompt === "string") {
    const prompt = body.prompt;
    const systemPrompt = `
You are a task classification assistant. Your job is to read a user's prompt and assign it one of these 8 categories only:

${taskCategories.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Return ONLY the name of the matching category. Do not explain your reasoning.
    `;
    try {
      const completion = await tryGroqCall({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      });
      const category =
        completion.choices[0]?.message?.content?.trim() ?? "Unknown";
      return NextResponse.json({ category });
    } catch (err) {
      console.error("Groq unavailable, falling back:", err);
      const category = fallbackClassifier(prompt);
      return NextResponse.json({ category });
    }
  }

  // General chat branch
  if (Array.isArray(body.messages)) {
    // Normalize roles and prep
    const normalized = (body.messages as any[]).map((m) => ({
      role: m.role === "ai" ? "assistant" : m.role,
      content: m.content,
    }));
    const full = [
      { role: "system", content: "You are a helpful AI assistant." },
      ...normalized,
    ];

    try {
      const completion = await tryGroqCall({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: full,
      });
      const text = completion.choices[0]?.message?.content ?? "";
      return NextResponse.json({ text });
    } catch (err) {
      console.error("Groq chat unavailable:", err);
      return NextResponse.json(
        {
          text: "⚠️ Sorry, the chat service is currently unavailable. Please try again later.",
        },
        { status: 503 }
      );
    }
  }

  // Bad payload
  return NextResponse.json(
    { error: "Must provide { prompt } or { messages }" },
    { status: 400 }
  );
}

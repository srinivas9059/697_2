import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

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
  const { prompt } = await req.json();

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

  const category = completion.choices[0]?.message?.content?.trim() ?? "Unknown";
  return NextResponse.json({ category });
}

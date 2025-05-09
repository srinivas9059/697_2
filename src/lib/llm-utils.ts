// src/lib/llm-utils.ts

const taskCategoryToKeywords: Record<string, string[]> = {
  "Writing / Content Creation": ["content generation", "text", "writing"],
  "Coding / Development": ["code", "development", "programming"],
  "Instruction / Learning": [
    "education",
    "instruction",
    "teaching",
    "learning",
  ],
  "Research / Information Retrieval": [
    "research",
    "qa",
    "retrieval",
    "knowledge",
  ],
  "Creative Generation": ["creative", "generation", "imagination"],
  "Conversation / Chat": [
    "chat",
    "dialogue",
    "conversation",
    "natural conversation",
  ],
  "Data Analysis": ["data", "analytics", "analysis"],
  "Multimodal (Image / Audio) Tasks": [
    "multimodal",
    "image",
    "audio",
    "vision",
  ],
};

export async function getLLMsByCategory(category: string, limit = 3) {
  const res = await fetch("/llmscl.json");
  const all = await res.json();

  const keywords = taskCategoryToKeywords[category] ?? [];

  const matches = all.filter((llm: any) =>
    keywords.some(
      (kw) =>
        llm.task_type?.toLowerCase().includes(kw) ||
        llm.tags?.some((tag: string) => tag.toLowerCase().includes(kw))
    )
  );

  if (matches.length === 0) {
    console.warn("⚠️ No matching LLMs for category:", category);
  }

  return matches.slice(0, limit);
}

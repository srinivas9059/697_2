// src/lib/classify.ts

export async function classifyViaApi(prompt: string): Promise<string> {
  const res = await fetch("/api/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error("classification failed");
  const json = await res.json();
  return json.category as string;
}

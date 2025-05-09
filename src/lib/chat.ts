// src/lib/chat.ts
export async function chatCompletion(
  messages: { role: string; content: string }[]
) {
  const res = await fetch("/api/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error("Chat error");
  const { text } = await res.json();
  return text;
}

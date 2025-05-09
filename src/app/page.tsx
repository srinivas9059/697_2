// src/app/page.tsx
"use client";
import { LLMOptions } from "../components/LLMOptions";
import { useEffect, useState } from "react";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import {
  createConversation,
  getConversations,
  addMessage,
  renameConversation,
  deleteConversation,
} from "../lib/firestore";
import type { Conversation, Message } from "../lib/firestore";
import { useRouter } from "next/navigation";
import { classifyViaApi } from "../lib/classify";
import { getLLMsByCategory } from "../lib/llm-utils";
import { addMessageToChat } from "../lib/firestore";

function isLLMCardMessage(m: Message) {
  try {
    return JSON.parse(m.text).type === "llm_suggestions";
  } catch {
    return false;
  }
}
type ChatStage =
  | "idle" // normal general chat mode
  | "onboarding" // right after “New Chat”
  | "awaitStartConfirm" // waiting for Yes/No to “start picking”
  | "awaitTaskPrompt"
  | "awaitLLMPreferences" // waiting for the user’s task description
  | "showLLMs" // you just displayed LLM cards
  | "awaitLLMAction" // waiting for “More LLMs” / “I Have Preferences” / “Do Tools?” / “Done”
  | "showTools" // you just displayed tool cards
  | "awaitToolAction"; // waiting for “More Tools” / “Done”

export default function ChatPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // inside ChatPage, before the return:
  const currentChat = conversations.find((c) => c.id === currentId);
  const messages = currentChat?.messages ?? [];
  const [stage, setStage] = useState<ChatStage>("onboarding");
  // ─── LLM menu state & handlers ─────────────────
  const [llmOffset, setLlmOffset] = useState(3);
  // Remember the very latest batch of models you showed
  const [initialModels, setInitialModels] = useState<any[]>([]);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [toolList, setToolList] = useState<any[]>([]); // full filtered list
  const [toolOffset, setToolOffset] = useState(0); // how many we’ve shown so far
  const [allTools, setAllTools] = useState<any[] | null>(null);
  const [cachedCategory, setCachedCategory] = useState<string | null>(null);

  async function fetchHuggingFaceModels(category: string) {
    const categoryToPipelineTag: Record<string, string> = {
      "Writing / Content Creation": "text-generation",
      "Coding / Development": "text-generation",
      "Instruction / Learning": "text2text-generation",
      "Research / Information Retrieval": "question-answering",
      "Creative Generation": "text-generation",
      "Conversation / Chat": "conversational",
      "Data Analysis": "tabular-classification", // adjust as needed
      "Multimodal (Image / Audio) Tasks": "multimodal",
    };

    const pipelineTag = categoryToPipelineTag[category] ?? "text-generation";

    const res = await fetch(
      `https://huggingface.co/api/models?pipeline_tag=${pipelineTag}&limit=12`
    );

    const models = await res.json();
    return models;
  }

  let toolCache: any[] | null = null;
  // Show 3 more LLMs
  async function handleShowMoreLLMs() {
    if (!lastPrompt || !userId || !currentId) return;

    setLoading(true);
    try {
      // 1) classify again (or cache the category from the first run)
      const category = cachedCategory ?? (await classifyViaApi(lastPrompt));
      if (!cachedCategory) setCachedCategory(category);

      // 2) compute new slice: [oldOffset, oldOffset + 3)
      const nextOffset = llmOffset + 3;
      // fetch enough picks to cover both old + new
      const allPicks = await getLLMsByCategory(category, nextOffset);
      // isolate *only* the new batch
      const newBatch = allPicks.slice(llmOffset, nextOffset);

      // 3) update offset for next time
      setLlmOffset(nextOffset);

      // 4) send just the new batch as a new message
      const cardMsg: Message = {
        role: "ai",
        text: JSON.stringify({
          type: "llm_suggestions",
          category,
          models: newBatch,
        }),
        timestamp: Date.now(),
      };

      await addMessage(userId, currentId, cardMsg);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentId ? { ...c, messages: [...c.messages, cardMsg] } : c
        )
      );
    } catch (err) {
      console.error("Error fetching more LLMs:", err);
    } finally {
      setLoading(false);
    }
  }
  async function fetchAndFilterTools(category: string) {
    // load + sanitize only once
    if (toolCache === null) {
      const raw = await fetch("/ai_tool_cards.json").then((r) => r.text());
      const clean = raw.replace(/\bNaN\b/g, "null");

      toolCache = JSON.parse(clean);
    }

    // break category into simple keywords
    const parts = category
      .split("/")
      .map((p) => p.trim().split(" ")[0].toLowerCase());

    // filter cached array
    return toolCache.filter((t) => {
      const tt = (t.task_type ?? "").toLowerCase();
      const tags = Array.isArray(t.tags)
        ? t.tags.map((x) => x.toLowerCase())
        : [];

      return parts.some(
        (p) => tt.includes(p) || tags.some((tag) => tag.includes(p))
      );
    });
  }
  // Ask the user for preferences
  function handleHavePreferences() {
    setStage("awaitLLMPreferences");
    // send a follow-up bot message:
    const botMsg: Message = {
      role: "ai",
      text: "Sure—what matters most to you? (e.g. cost, open-source, privacy)",
      timestamp: Date.now(),
    };
    addMessage(userId!, currentId!, botMsg).catch(console.error);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === currentId ? { ...c, messages: [...c.messages, botMsg] } : c
      )
    );
  }

  // Trigger the Tool-Recommendation flow
  // … top‐of‐component state unmodified …

  // 1) First 3 tools (clearing old tool messages)
  async function handleShowTools() {
    if (!lastPrompt || !userId || !currentId) return;

    setStage("awaitToolAction");
    setLoading(true);

    try {
      // 1. Classify only once per prompt
      const category = cachedCategory ?? (await classifyViaApi(lastPrompt));
      if (!cachedCategory) setCachedCategory(category);

      // 2. Load & filter your cached JSON
      const filtered = await fetchAndFilterTools(category);
      setToolList(filtered);
      setToolOffset(3);

      // 3. Remove any prior tool_suggestions messages
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentId
            ? {
                ...c,
                messages: c.messages.filter((m) => {
                  try {
                    return JSON.parse(m.text).type !== "tool_suggestions";
                  } catch {
                    return true;
                  }
                }),
              }
            : c
        )
      );

      // 4. Send the first 3 tools
      const firstBatch = filtered.slice(0, 3);
      console.log("show first tool batch", firstBatch);

      const toolMsg: Message = {
        role: "ai",
        text: JSON.stringify({
          type: "tool_suggestions",
          category,
          tools: firstBatch,
        }),
        timestamp: Date.now(),
      };

      await addMessage(userId, currentId, toolMsg);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentId ? { ...c, messages: [...c.messages, toolMsg] } : c
        )
      );
    } catch (err) {
      console.error("Failed to load tools:", err);
    } finally {
      setLoading(false);
    }
  }

  // 2) More Tools (only if there’s something new)
  function handleMoreTools() {
    if (toolOffset >= toolList.length) return; // nothing left
    const next = Math.min(toolOffset + 3, toolList.length);
    const batch = toolList.slice(toolOffset, next);
    setToolOffset(next);

    if (batch.length === 0) return;

    console.log("show more tool batch", batch);
    const toolMsg: Message = {
      role: "ai",
      text: JSON.stringify({
        type: "tool_suggestions",
        tools: batch,
      }),
      timestamp: Date.now(),
    };

    addMessage(userId!, currentId!, toolMsg);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === currentId ? { ...c, messages: [...c.messages, toolMsg] } : c
      )
    );
  }

  // 3) Done button
  function handleToolDone() {
    setStage("idle");
    const botMsg: Message = {
      role: "ai",
      text: "Alright—switching to general chat. Let me know if you want to revisit your recommendations!",
      timestamp: Date.now(),
    };
    addMessage(userId!, currentId!, botMsg);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === currentId ? { ...c, messages: [...c.messages, botMsg] } : c
      )
    );
  }

  // Exit back to general chat
  function handleDone() {
    setStage("idle");
    const botMsg: Message = {
      role: "ai",
      text: "Okay, switching back to general chat. Let me know if you want to pick another LLM!",
      timestamp: Date.now(),
    };
    addMessage(userId!, currentId!, botMsg).catch(console.error);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === currentId ? { ...c, messages: [...c.messages, botMsg] } : c
      )
    );
  }

  // ────────────────────────────────────────────────
  function isToolCardMessage(m: Message) {
    try {
      return JSON.parse(m.text).type === "tool_suggestions";
    } catch {
      return false;
    }
  }
  useEffect(() => {
    fetch("/ai_tool_cards.json")
      .then((r) => r.text())
      .then((raw) => raw.replace(/\bNaN\b/g, "null"))
      .then((clean) => setAllTools(JSON.parse(clean)))
      .catch(console.error);
  }, []);

  // 2. Onboarding Sequence
  useEffect(() => {
    if (stage === "onboarding" && currentChat && userId) {
      const welcomeMsg: Message = {
        role: "ai",
        text: JSON.stringify({
          type: "welcome_and_menu",
          text: "Welcome! Are you ready to start picking the perfect LLM for your task?",
        }),
        timestamp: Date.now(),
      };

      // 1) Persist it to Firestore using your existing helper
      addMessage(userId, currentChat.id, welcomeMsg).catch(console.error);
      const welcomeToolsMsg: Message = {
        role: "ai",
        text: JSON.stringify({ type: "welcome_menu" }),
        timestamp: Date.now(),
      };
      addMessage(userId, currentId, welcomeToolsMsg).catch(console.error);
      // 2) Update the conversations state so the UI shows the new message
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentChat.id
            ? { ...c, messages: [...c.messages, welcomeMsg] }
            : c
        )
      );

      // 3) Advance to the next stage
      setStage("awaitStartConfirm");
    }
  }, [stage, currentChat, userId, addMessage, setConversations]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
        loadChats(user.uid);
      } else {
        router.push("/login");
      }
    });
    return unsub;
  }, [router]);

  async function loadChats(uid: string) {
    const chats = await getConversations(uid);
    setConversations(chats);
    if (chats.length) setCurrentId(chats[0].id);
  }

  async function handleNewChat() {
    if (!userId) return;
    const name = `Chat ${conversations.length + 1}`;
    const id = await createConversation(userId, name);

    // 1) Add it to state
    setConversations([
      ...conversations,
      { id, name, createdAt: Date.now(), messages: [] },
    ]);
    setCurrentId(id);

    // 2) Reset the stage so onboarding runs again
    setStage("onboarding");

    // 3) Clear the input
    setInput("");
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !userId || !currentId) return;

    // 1) Persist the user's message
    const userMsg: Message = {
      role: "user",
      text,
      timestamp: Date.now(),
    };
    await addMessage(userId, currentId, userMsg);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === currentId ? { ...c, messages: [...c.messages, userMsg] } : c
      )
    );

    // 2) Clear the input immediately
    setInput("");
    if (stage === "awaitHuggingfacePrompt") {
      setStage("idle");
      setInput("");
      setLoading(true);

      const userPrompt = text;
      const category = await classifyViaApi(userPrompt); // reuse your classifier
      const models = await fetchHuggingFaceModels(category); // ✅ fetch from HF
      const top3 = models.slice(0, 3);

      const botMsg: Message = {
        role: "ai",
        text: JSON.stringify({
          type: "huggingface_models",
          category,
          models: top3.map((m: any) => ({
            id: m.modelId || m.id, // support both HF APIs
            downloads: m.downloads,
            likes: m.likes,
            tags: m.tags,
          })),
        }),
        timestamp: Date.now(),
      };

      await addMessage(userId!, currentId!, botMsg);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentId ? { ...c, messages: [...c.messages, botMsg] } : c
        )
      );

      setLoading(false);
      return;
    }

    // ─── Stage 1: Onboarding Yes/No ──────────────────────────────
    if (stage === "awaitStartConfirm") {
      const lc = text.toLowerCase();
      let reply: Message;

      if (lc === "yes") {
        setStage("awaitTaskPrompt");
        reply = {
          role: "ai",
          text: "Great! What task or prompt do you have in mind?",
          timestamp: Date.now(),
        };
      } else if (lc === "no") {
        setStage("idle");
        reply = {
          role: "ai",
          text: "Alright, we’re now in general chat mode—ask me anything, or say “yes” anytime to start picking an LLM!",
          timestamp: Date.now(),
        };
      } else {
        // didn’t understand
        reply = {
          role: "ai",
          text: "Sorry, I didn’t catch that—please reply “yes” or “no.”",
          timestamp: Date.now(),
        };
      }

      await addMessage(userId, currentId, reply);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentId ? { ...c, messages: [...c.messages, reply] } : c
        )
      );
      return;
    }

    // ─── Stage 2: Task Prompt → LLM Suggestions ────────────────
    // ─── Stage 2: Task Prompt → LLM Suggestions ────────────────
    if (stage === "awaitTaskPrompt") {
      // 1) remember what they asked
      setLastPrompt(text);
      // reset “Show More” pagination
      setLlmOffset(3);

      // 2) move into the LLM‐cards stage
      setStage("awaitLLMAction");

      try {
        // 3) classify & fetch the top 3
        const category = await classifyViaApi(text);
        const llms = await getLLMsByCategory(category, 3);

        // 4) stash these for later (preferences flow)
        setInitialModels(llms);

        // 5) package into a card message
        const cardMsg: Message = {
          role: "ai",
          text: JSON.stringify({
            type: "llm_suggestions",
            category,
            models: llms,
          }),
          timestamp: Date.now(),
        };

        // 6) persist & display
        await addMessage(userId, currentId, cardMsg);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === currentId
              ? { ...c, messages: [...c.messages, cardMsg] }
              : c
          )
        );
      } catch (err) {
        const errMsg: Message = {
          role: "ai",
          text: "⚠️ Sorry, I couldn’t fetch LLM recommendations.",
          timestamp: Date.now(),
        };
        await addMessage(userId, currentId, errMsg);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === currentId ? { ...c, messages: [...c.messages, errMsg] } : c
          )
        );
      }

      return;
    }

    // ─── Stage 2.5: Preferences branch ─────────────────────────
    if (stage === "awaitLLMPreferences") {
      // 1) capture what the user typed
      const prefs = text;

      // 2) build a comparison prompt
      const systemPrompt =
        "You are an expert at matching LLMs to user preferences.";
      const userContent = `
User preferences: ${prefs}

Here are the models I previously recommended:
${initialModels
  .map((m, i) => `${i + 1}. ${m.title} — ${m.description}`)
  .join("\n")}

Question: Which of these best fits the user’s preferences, and why?
If there is another model in our catalog that fits even better, please recommend it briefly.
`.trim();

      // 3) send it to your single /api/classify chat route
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        }),
      });

      // 4) read or fallback
      let replyText: string;
      if (!res.ok) {
        replyText = "⚠️ Sorry, couldn’t process preferences. Try again?";
      } else {
        const data = await res.json();
        replyText = data.text;
      }

      // 5) append that comparison reply
      const cmpMsg: Message = {
        role: "ai",
        text: replyText,
        timestamp: Date.now(),
      };
      await addMessage(userId!, currentId!, cmpMsg);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentId ? { ...c, messages: [...c.messages, cmpMsg] } : c
        )
      );

      // 6) go back to showing the 4-button menu
      setStage("awaitLLMAction");
      return;
    }

    // ─── Stage 3: General Chat Mode ──────────────────────────────
    if (stage === "idle") {
      // inside handleSend, stage === "idle":
      // inside handleSend(), when stage === "idle"
      setLoading(true);

      // Build the chat history payload
      const history = (
        conversations.find((c) => c.id === currentId)?.messages ?? []
      )
        .map((m) => ({ role: m.role, content: m.text }))
        .concat({ role: "user", content: text });

      // Send to the same /api/classify route, but now with messages
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      // 🔧 Harden here:
      let aiText: string;
      if (!res.ok) {
        // Safely consume any JSON error or fallback to text
        let errorPayload: any;
        try {
          errorPayload = await res.json();
        } catch {
          errorPayload = await res.text();
        }
        console.error("Chat API error:", res.status, errorPayload);
        aiText = "⚠️ Sorry, something went wrong. Please try again.";
      } else {
        // Only parse JSON if status is OK
        const data = await res.json();
        aiText = data.text;
      }

      setLoading(false);

      // Append the AI reply as usual
      const botMsg: Message = {
        role: "ai",
        text: aiText,
        timestamp: Date.now(),
      };
      await addMessage(userId, currentId, botMsg);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentId ? { ...c, messages: [...c.messages, botMsg] } : c
        )
      );

      return;
    }

    // ─── Other stages (awaitLLMAction / awaitToolAction) ─────────
    // Leave these to your button‐click handlers—no default behavior here.
  }

  async function handleRename(id: string) {
    const newName = prompt("Enter new name");
    if (!userId || !newName) return;
    await renameConversation(userId, id, newName);
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: newName } : c))
    );
  }

  async function handleDelete(id: string) {
    if (!userId) return;
    await deleteConversation(userId, id);
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (currentId === id && remaining.length) setCurrentId(remaining[0].id);
  }

  function handleLogout() {
    signOut(auth).then(() => router.push("/login"));
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white p-4 flex flex-col">
        <button
          className="mb-4 p-2 w-full bg-blue-600 hover:bg-blue-700 rounded"
          onClick={handleNewChat}
        >
          + New Chat
        </button>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => setCurrentId(c.id)}
              className={`flex justify-between items-center px-2 py-1 mb-1 cursor-pointer rounded hover:bg-gray-700 ${
                c.id === currentId ? "bg-gray-700" : ""
              }`}
            >
              <span className="truncate max-w-[120px]">{c.name}</span>
              <button
                className="text-gray-400 hover:text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  const choice = prompt("Type rename or delete");
                  if (choice === "rename") handleRename(c.id);
                  else handleDelete(c.id);
                }}
              >
                …
              </button>
            </div>
          ))}
        </div>

        {/* Logout */}
        <div className="mt-auto pt-4 border-t border-gray-700 text-center">
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-white"
          >
            🔓 Logout
          </button>
        </div>
      </aside>

      {/* Chat Area */}
      <main className="flex flex-col flex-1 bg-gray-900 text-white">
        <header className="flex items-center justify-between px-6 py-4 border-b">
          <h1 className="text-2xl font-bold">WELCOME to AI Compass</h1>
          <span>👤</span>
        </header>

        <div className="flex-1 p-4 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-gray-400">💬 Conversation will appear here...</p>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={`mb-4 ${
                  m.role === "user" ? "text-right" : "text-left"
                }`}
              >
                {isLLMCardMessage(m) ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {JSON.parse(m.text).models.map(
                        (model: any, j: number) => (
                          <div
                            key={j}
                            className="bg-gray-800 text-white p-4 rounded-lg shadow-lg border border-gray-700"
                          >
                            <h2 className="font-bold text-lg mb-1">
                              {model.title}
                            </h2>
                            <p className="text-sm text-gray-300 mb-2">
                              {model.description}
                            </p>
                            <div className="text-xs text-gray-400 mb-1">
                              <strong>Task:</strong> {model.task_type}
                            </div>
                            <div className="text-xs text-gray-400 mb-2">
                              <strong>Tags:</strong>{" "}
                              {model.tags?.slice(0, 3).join(", ") || "None"}
                            </div>
                            <a
                              href={model.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline text-sm"
                            >
                              ↗ Visit Website
                            </a>
                          </div>
                        )
                      )}
                    </div>
                    {stage === "awaitLLMAction" && (
                      <LLMOptions
                        onShowMore={handleShowMoreLLMs}
                        onPrefs={handleHavePreferences}
                        onTools={handleShowTools}
                        onDone={handleDone}
                      />
                    )}
                  </>
                ) : isToolCardMessage(m) ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {JSON.parse(m.text).tools.map((tool: any, j: number) => (
                        <div
                          key={j}
                          className="bg-gray-800 text-white p-4 rounded-lg shadow-lg border border-gray-700"
                        >
                          <h3 className="font-bold text-lg mb-1">
                            {tool.name}
                          </h3>
                          <p className="text-sm text-gray-300 mb-2">
                            {tool.description}
                          </p>
                          <a
                            href={tool.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline text-sm"
                          >
                            ↗ Visit Website
                          </a>
                        </div>
                      ))}
                    </div>
                    {stage === "awaitToolAction" && (
                      <div className="flex flex-wrap gap-3 mt-4">
                        <button
                          onClick={handleMoreTools}
                          className="flex items-center space-x-2 px-4 py-1.5 rounded-2xl border border-gray-500 text-white hover:brightness-90"
                        >
                          More Tools
                        </button>
                        <button
                          onClick={handleToolDone}
                          className="flex items-center space-x-2 px-4 py-1.5 rounded-2xl text-red-400 hover:brightness-90"
                        >
                          Done
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  (() => {
                    try {
                      const parsed = JSON.parse(m.text);

                      if (parsed.type === "huggingface_models") {
                        console.log("Hugging Face payload:", parsed.models);

                        return (
                          <>
                            <h3 className="text-lg font-bold mb-2">
                              Top Hugging Face Models for: {parsed.category}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              {parsed.models.map((model: any, j: number) => (
                                <div
                                  key={j}
                                  className="bg-gray-800 text-white p-4 rounded-lg shadow-lg border border-gray-700"
                                >
                                  <h4 className="font-bold text-lg mb-1">
                                    {model.id}
                                  </h4>
                                  <p className="text-sm text-gray-300 mb-1">
                                    Tags:{" "}
                                    {model.tags?.slice(0, 3).join(", ") ||
                                      "N/A"}
                                  </p>
                                  <p className="text-sm text-gray-400">
                                    🔥 {model.downloads ?? 0} downloads | ❤️{" "}
                                    {model.likes ?? 0} likes
                                  </p>
                                  <a
                                    href={`https://huggingface.co/${model.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:underline text-sm mt-2 inline-block"
                                  >
                                    ↗ Try on Hugging Face
                                  </a>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      }

                      if (parsed.type === "welcome_and_menu") {
                        return (
                          <>
                            <span className="inline-block bg-gray-700 px-3 py-1 rounded">
                              {parsed.text}
                            </span>
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={() => {
                                  setStage("awaitHuggingfacePrompt");
                                  const hint: Message = {
                                    role: "ai",
                                    text: "Sure! What kind of AI model are you searching for?",
                                    timestamp: Date.now(),
                                  };
                                  addMessage(userId!, currentId!, hint);
                                  setConversations((prev) =>
                                    prev.map((c) =>
                                      c.id === currentId
                                        ? {
                                            ...c,
                                            messages: [...c.messages, hint],
                                          }
                                        : c
                                    )
                                  );
                                }}
                                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
                              >
                                🔍 Search on Hugging Face
                              </button>
                            </div>
                          </>
                        );
                      }
                    } catch {}
                    return (
                      <span className="inline-block bg-gray-700 px-3 py-1 rounded">
                        {m.text}
                      </span>
                    );
                  })()
                )}
              </div>
            ))
          )}
        </div>

        {/* Input Box */}
        <div className="flex items-center gap-2 px-4 py-3 border-t">
          <button className="p-2 text-xl text-gray-600">➕</button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask something..."
            className="flex-1 px-4 py-2 rounded border border-gray-600 bg-gray-800 text-white"
          />
          <button
            onClick={handleSend}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            disabled={loading}
          >
            {loading ? "…" : "Send"}
          </button>
        </div>
      </main>
    </div>
  );
}

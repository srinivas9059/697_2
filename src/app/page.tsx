// src/app/page.tsx
"use client";

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
  | "awaitTaskPrompt" // waiting for the user’s task description
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

  // 2. Onboarding Sequence
  useEffect(() => {
    if (stage === "onboarding" && currentChat && userId) {
      const welcomeMsg: Message = {
        role: "ai",
        text: "Welcome! Are you ready to start picking the perfect LLM for your task?",
        timestamp: Date.now(),
      };

      // 1) Persist it to Firestore using your existing helper
      addMessage(userId, currentChat.id, welcomeMsg).catch(console.error);

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
    if (stage === "awaitTaskPrompt") {
      setStage("awaitLLMAction");

      try {
        const category = await classifyViaApi(text);
        const llms = await getLLMsByCategory(category, 3);

        const cardMsg: Message = {
          role: "ai",
          text: JSON.stringify({
            type: "llm_suggestions",
            category,
            models: llms,
          }),
          timestamp: Date.now(),
        };

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
          +{" "}
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {JSON.parse(m.text).models.map((model: any, j: number) => (
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
                    ))}
                  </div>
                ) : (
                  <span className="inline-block bg-gray-700 px-3 py-1 rounded">
                    {m.text}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Input */}
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

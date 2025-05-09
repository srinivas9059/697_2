// src/components/LLMCardList.tsx

import React from "react";

interface LLMProps {
  llms: {
    title: string;
    link: string;
    description: string;
    task_type: string;
    tags: string[];
    highlights?: string;
    user_insights?: { question: string; answer: string }[];
  }[];
}

export default function LLMCardList({ llms }: { llms: any[] }) {
  if (!llms || llms.length === 0) return null;

  return (
    <div className="space-y-4 mt-4">
      {llms.map((llm, index) => (
        <div
          key={index}
          className="border border-gray-700 bg-gray-800 rounded-lg p-4 shadow-md text-white"
        >
          <h2 className="text-lg font-bold mb-1">{llm.title}</h2>
          <p className="text-sm text-gray-300 mb-2">{llm.description}</p>
          <div className="text-xs text-gray-400 mb-1">
            <strong>Task:</strong> {llm.task_type}
          </div>
          <div className="text-xs text-gray-400 mb-2">
            <strong>Tags:</strong> {llm.tags?.slice(0, 3).join(", ") || "None"}
          </div>
          <a
            href={llm.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline text-sm"
          >
            ↗ Visit Website
          </a>
        </div>
      ))}
    </div>
  );
}

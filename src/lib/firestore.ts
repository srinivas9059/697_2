// Step 2: Firestore schema setup and save/load logic

// 1. Define your Firestore collections:
// - users/{userId}/conversations/{conversationId}
// - Each conversation contains: { name, createdAt, messages: [ { role, text, timestamp } ] }

// 2. Create src/lib/firestore.ts to handle Firebase read/write logic

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  arrayUnion,
} from "firebase/firestore";
import { auth, db } from "../firebase";

// Types
export interface Message {
  role: "user" | "ai";
  text: string;
  timestamp: number;
}
export async function addMessageToChat(chatId: string, message: Message) {
  const chatRef = doc(
    db,
    "users",
    auth.currentUser!.uid,
    "conversations",
    chatId
  );
  // or wherever your chats actually live
  await updateDoc(chatRef, { messages: arrayUnion(message) });
}

export interface Conversation {
  id: string;
  name: string;
  createdAt: number;
  messages: Message[];
}

// Get all conversations for the current user
export async function getConversations(
  userId: string
): Promise<Conversation[]> {
  const snapshot = await getDocs(
    collection(db, "users", userId, "conversations")
  );
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Conversation[];
}

// Create a new conversation
export async function createConversation(
  userId: string,
  name: string
): Promise<string> {
  const newDoc = await addDoc(
    collection(db, "users", userId, "conversations"),
    {
      name,
      createdAt: Date.now(),
      messages: [],
    }
  );
  return newDoc.id;
}

// Update conversation name
export async function renameConversation(
  userId: string,
  convoId: string,
  name: string
) {
  await updateDoc(doc(db, "users", userId, "conversations", convoId), { name });
}

// Delete conversation
export async function deleteConversation(userId: string, convoId: string) {
  await deleteDoc(doc(db, "users", userId, "conversations", convoId));
}

// Add a message
export async function addMessage(
  userId: string,
  convoId: string,
  msg: Message
) {
  const ref = doc(db, "users", userId, "conversations", convoId);
  const snap = await getDoc(ref);
  const oldMsgs = snap.data()?.messages || [];
  await updateDoc(ref, { messages: [...oldMsgs, msg] });
}

"use client";

import { useState } from "react";
import { auth } from "../../firebase";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { useRouter } from "next/navigation";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const signup = async () => {
    setError(null);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      router.replace("/");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const signupWithGoogle = async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
    router.replace("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-center text-black">
          Sign Up
        </h2>
        {error && <p className="mb-4 text-red-600">{error}</p>}
        <label className="block mb-2 text-black">
          Email
          <input
            type="email"
            className="mt-1 block w-full border rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block mb-4 text-black">
          Password
          <input
            type="password"
            className="mt-1 block w-full border rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          onClick={signup}
          className="w-full bg-blue-600 text-white py-2 rounded mb-4 hover:bg-blue-700 text-black "
        >
          Create account
        </button>
        <button
          onClick={signupWithGoogle}
          className="w-full border border-gray-300 py-2 rounded flex items-center justify-center text-black gap-2 mb-4 hover:bg-gray-100"
        >
          <img src="/gicon.svg" alt="" className="w-5 h-5 text-black" />
          Continue with Google
        </button>
        <p className="text-center text-sm text-black">
          Have an account?{" "}
          <a href="/login" className="text-blue-600 hover:underline">
            Log in
          </a>
        </p>
        <p className="text-center mt-2 text-sm text-black">
          <a href="/forgot-password" className="text-blue-600 hover:underline">
            Forgot Password?
          </a>
        </p>
      </div>
    </div>
  );
}

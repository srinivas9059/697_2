"use client";

import { useEffect, useState } from "react";
import { auth } from "../../firebase";
import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import animationData from "./ai-login.json";

// Dynamically load Lottie on client only
const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

export default function LoginPage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) router.replace("/");
      else setLoading(false);
    });
    return unsub;
  }, [router]);

  const loginWithEmail = async () => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged redirect will fire
    } catch (e: any) {
      setError(e.message);
    }
  };

  const loginWithGoogle = () =>
    signInWithPopup(auth, new GoogleAuthProvider()).catch((e) =>
      setError(e.message)
    );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-r from-indigo-600 to-purple-600">
        <p className="text-white text-xl animate-pulse">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-r from-indigo-600 to-purple-600">
      <motion.div
        className="bg-white bg-opacity-20 backdrop-blur-lg rounded-xl p-8 max-w-sm w-full text-center shadow-xl"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        {/* Lottie animation */}
        <div className="w-48 h-48 mx-auto">
          <Lottie animationData={animationData} loop autoplay />
        </div>

        <h1 className="text-2xl font-bold text-black mt-4">
          Welcome to AI Picker
        </h1>
        <p className="text-black/80 mb-6">
          Sign in with your email or Google to get started
        </p>

        {/* Error message */}
        {error && (
          <p className="mb-4 text-red-200 bg-red-800 bg-opacity-50 p-2 rounded">
            {error}
          </p>
        )}

        {/* Email/password inputs */}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="block w-full mb-3 p-2 rounded border border-white/50 bg-white/80 text-black placeholder-gray-600"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="block w-full mb-4 p-2 rounded border border-white/50 bg-white/80 text-black placeholder-gray-600"
        />
        <button
          onClick={loginWithEmail}
          className="w-full mb-4 px-4 py-2 bg-white text-indigo-600 font-semibold rounded hover:bg-white/90 active:scale-95 transition"
        >
          Log in
        </button>

        {/* OR separator */}
        <div className="flex items-center mb-4">
          <hr className="flex-grow border-white/50" />
          <span className="px-2 text-black">OR</span>
          <hr className="flex-grow border-white/50" />
        </div>

        {/* Google sign-in */}
        <button
          onClick={loginWithGoogle}
          className="w-full text-black flex items-center justify-center gap-2 px-4 py-2 bg-white text-indigo-600 font-semibold rounded hover:bg-white/90 active:scale-95 transition"
        >
          <img src="/gicon.svg" alt="Google logo" className="w-5 h-5" />
          Continue with Google
        </button>

        {/* Links */}
        <p className="mt-6 text-center text-black">
          {" "}
          Don’t have an account?{" "}
          <a href="/signup" className="underline">
            Sign Up
          </a>
        </p>

        <p className="mt-2 text-center text-black">
          <a href="/forgot-password" className="underline">
            Forgot Password?
          </a>
        </p>
      </motion.div>
    </div>
  );
}

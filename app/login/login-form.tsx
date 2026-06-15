"use client";

import { FormEvent, useState } from "react";
import { Lock, LogIn, Mail, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/browser";

type Mode = "login" | "signup";
type Status = "idle" | "loading" | "success" | "error";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const isLoading = status === "loading";
  const canSubmit =
    email.trim().length > 0 && password.length >= 6 && !isLoading;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");

    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setStatus("error");
        setMessage(getAuthErrorMessage(error.message, "signup"));
        return;
      }

      if (data.session) {
        router.push("/");
        router.refresh();
        return;
      }

      setStatus("success");
      setMessage("注册好了。如果 Supabase 要求邮箱确认，先去邮箱点一下确认链接，再回来登录。");
      setMode("login");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus("error");
      setMessage(getAuthErrorMessage(error.message, "login"));
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
        邮箱
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <Input
            required
            autoComplete="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="h-11 pl-9"
          />
        </div>
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
        密码
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <Input
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 6 位"
            className="h-11 pl-9"
          />
        </div>
      </label>

      <Button
        className="h-11"
        disabled={!canSubmit}
        type="submit"
      >
        {mode === "login" ? (
          <LogIn className="size-4" />
        ) : (
          <UserPlus className="size-4" />
        )}
        {isLoading ? "处理中" : mode === "login" ? "登录" : "注册"}
      </Button>

      {message ? (
        <p
          className={
            status === "error"
              ? "text-sm text-red-600"
              : "text-sm text-neutral-600"
          }
        >
          {message}
        </p>
      ) : null}

      <button
        className="text-sm font-medium text-neutral-600 underline-offset-4 hover:text-neutral-950 hover:underline"
        disabled={isLoading}
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setStatus("idle");
          setMessage("");
        }}
        type="button"
      >
        {mode === "login"
          ? "还没有账号？先注册一个"
          : "已经有账号了？回去登录"}
      </button>
    </form>
  );
}

function getAuthErrorMessage(message: string, mode: Mode) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("invalid login credentials")) {
    return "邮箱或密码不对。啊这，先别怀疑人生，重新输一下试试。";
  }

  if (lowerMessage.includes("email not confirmed")) {
    return "这个邮箱还没确认。去邮箱里点一下确认链接，再回来登录。";
  }

  if (lowerMessage.includes("already registered")) {
    return "这个邮箱已经注册过了，直接登录就行。";
  }

  if (lowerMessage.includes("password")) {
    return "密码格式不太对。开发期先用至少 6 位的密码。";
  }

  return mode === "signup"
    ? "注册没成功。检查一下邮箱和密码，或者看看 Supabase 有没有关掉注册。"
    : "登录没成功。检查一下邮箱和密码，再试一次。";
}

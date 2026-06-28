"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function MessageComposer({
  disabled,
  isStreaming,
  onSend,
  onStop,
}: {
  disabled?: boolean;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !disabled;

  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  function submit() {
    const value = text.trim();

    if (!value || disabled) {
      return;
    }

    onSend(value);
    setText("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as KeyboardEvent["nativeEvent"] & {
      isComposing?: boolean;
      keyCode?: number;
    };
    const isComposing =
      isComposingRef.current ||
      nativeEvent.isComposing === true ||
      nativeEvent.keyCode === 229;

    if (isComposing) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      className="flex items-end gap-2 border-t border-neutral-200 bg-[#f7f4ef]/95 px-3 py-3 backdrop-blur sm:px-5"
      onSubmit={handleSubmit}
    >
      <Textarea
        ref={textareaRef}
        aria-label="输入消息"
        className="max-h-36 min-h-11 resize-none rounded-3xl border-neutral-300 bg-white px-4 py-3 shadow-none"
        disabled={disabled}
        onCompositionEnd={() => {
          isComposingRef.current = false;
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="随便说点什么"
        rows={1}
        value={text}
      />

      {isStreaming ? (
        <Button
          aria-label="停止回复"
          className="size-11 rounded-full"
          onClick={onStop}
          size="icon"
          type="button"
          variant="secondary"
        >
          <Square className="size-4 fill-current" />
        </Button>
      ) : (
        <Button
          aria-label="发送"
          className="size-11 rounded-full bg-[#0a84ff] hover:bg-[#0875df]"
          disabled={!canSend}
          size="icon"
          type="submit"
        >
          <Send className="size-4" />
        </Button>
      )}
    </form>
  );
}

"use client";

import { useRef, useState } from "react";
import {
  Send,
  Paperclip,
  Download,
  Clipboard,
  X,
  Check,
  FileIcon,
} from "lucide-react";

export interface ChatItem {
  id: string;
  sender: string;
  text: string;
  ts: number;
  self: boolean;
}

export interface FileItem {
  id: string;
  name: string;
  size: number;
  url?: string;
  progress: number;
  direction: "sent" | "received";
}

interface SessionSidePanelProps {
  open: boolean;
  onClose: () => void;
  chats: ChatItem[];
  files: FileItem[];
  onSendChat: (text: string) => void;
  onSendFile: (file: File) => void;
  onSyncClipboard: () => void;
  clipboardSynced: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SessionSidePanel({
  open,
  onClose,
  chats,
  files,
  onSendChat,
  onSendFile,
  onSyncClipboard,
  clipboardSynced,
}: SessionSidePanelProps) {
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"chat" | "files">("chat");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const submitChat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendChat(trimmed);
    setText("");
  };

  return (
    <aside className="fixed right-0 top-0 bottom-0 z-40 w-full max-w-sm border-l border-zinc-800 bg-[#111115]/95 backdrop-blur-xl flex flex-col shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-1.5 bg-zinc-900 rounded-lg p-1">
          <button
            onClick={() => setTab("chat")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer ${
              tab === "chat"
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Chat ({chats.length})
          </button>
          <button
            onClick={() => setTab("files")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer ${
              tab === "files"
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Files ({files.length})
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onSyncClipboard}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition cursor-pointer"
            title="Push local clipboard to remote peer"
          >
            {clipboardSynced ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Clipboard className="h-3.5 w-3.5" />
            )}
            <span>Clip</span>
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {tab === "chat" ? (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chats.length === 0 && (
              <p className="text-center text-xs text-zinc-500 mt-8">
                Send a message or paste text to sync across devices.
              </p>
            )}
            {chats.map((c) => (
              <div
                key={c.id}
                className={`flex flex-col ${
                  c.self ? "items-end" : "items-start"
                }`}
              >
                <span className="text-[10px] text-zinc-500 mb-1">
                  {c.self ? "You" : c.sender}
                </span>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm break-words ${
                    c.self
                      ? "bg-red-600 text-white rounded-br-sm"
                      : "bg-zinc-800 text-zinc-100 rounded-bl-sm"
                  }`}
                >
                  {c.text}
                </div>
              </div>
            ))}
          </div>

          <form
            onSubmit={submitChat}
            className="border-t border-zinc-800 p-3 flex items-center gap-2"
          >
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message peer..."
              className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
            />
            <button
              type="submit"
              className="rounded-xl bg-red-600 hover:bg-red-500 p-2.5 text-white transition cursor-pointer"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </>
      ) : (
        <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSendFile(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 hover:bg-zinc-900 hover:border-red-500/60 py-4 text-sm font-medium text-zinc-300 transition cursor-pointer"
          >
            <Paperclip className="h-4 w-4 text-red-400" />
            Send File (P2P Direct)
          </button>

          <div className="mt-4 space-y-2.5">
            {files.length === 0 && (
              <p className="text-center text-xs text-zinc-500 mt-6">
                No files transferred in this session yet.
              </p>
            )}
            {files.map((f) => (
              <div
                key={f.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileIcon className="h-4 w-4 text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-200 truncate">
                      {f.name}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {formatBytes(f.size)} ·{" "}
                      {f.direction === "sent" ? "Sent" : "Received"} ·{" "}
                      {f.progress}%
                    </p>
                  </div>
                </div>
                {f.url && (
                  <a
                    href={f.url}
                    download={f.name}
                    className="rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 p-2 transition shrink-0"
                    title="Download file"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

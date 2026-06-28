"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteEntryButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) {
      return;
    }
    if (!window.confirm("删除这条记录？删了就找不回来了。")) {
      return;
    }

    setDeleting(true);

    try {
      const response = await fetch(`/api/entries/${entryId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }

      router.push("/archive");
      router.refresh();
    } catch (error) {
      console.error("Could not delete entry.", error);
      setDeleting(false);
      window.alert("删除失败，待会儿再试。");
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="rounded-full px-3 py-1 text-xs font-medium text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {deleting ? "删除中…" : "删除"}
    </button>
  );
}

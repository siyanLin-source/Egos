// 立刻流式渲染的骨架屏：服务器还在连 Supabase 时，浏览器先看到这个，
// 而不是一片空白转圈。数据就绪后 Next.js 自动替换成真正的聊天页。
export default function Loading() {
  return (
    <main className="flex h-dvh flex-col bg-[#f7f4ef] text-neutral-950">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-[#f7f4ef]/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="h-5 w-24 animate-pulse rounded bg-neutral-200" />
        <div className="h-7 w-20 animate-pulse rounded-full bg-neutral-200" />
      </header>

      <div className="flex-1 overflow-hidden px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <div className="h-16 w-2/3 animate-pulse rounded-2xl bg-neutral-200" />
          <div className="h-12 w-1/2 animate-pulse self-end rounded-2xl bg-neutral-200" />
          <div className="h-20 w-3/4 animate-pulse rounded-2xl bg-neutral-200" />
        </div>
      </div>

      <div className="shrink-0 border-t border-neutral-200 px-4 py-4 sm:px-6">
        <div className="mx-auto h-12 w-full max-w-3xl animate-pulse rounded-full bg-neutral-200" />
      </div>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cleanEntries } from "@/lib/archive/clean-entries";
import { buildPeople, type PersonView } from "@/lib/archive/people";
import { createClient } from "@/lib/supabase/server";
import type { Entry, ProfileFact, Topic } from "@/lib/types";

const TYPE_LABELS: Record<PersonView["type"], string> = {
  person: "人物",
  pet: "宠物",
  place: "地点",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function PersonCard({ person }: { person: PersonView }) {
  return (
    <Link
      href={`/people/${encodeURIComponent(person.name)}`}
      className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-medium text-neutral-950">
          {person.name}
        </span>
        <span className="rounded-full bg-[#e7efe7] px-2.5 py-1 text-xs font-medium text-[#256f5b]">
          {TYPE_LABELS[person.type]}
        </span>
      </div>
      <p className="text-xs text-neutral-500">
        {person.count} 条记录 · 最近 {formatDate(person.lastAt)}
      </p>
    </Link>
  );
}

function Section({ title, people }: { title: string; people: PersonView[] }) {
  if (people.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-neutral-500">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((person) => (
          <PersonCard key={person.key} person={person} />
        ))}
      </div>
    </div>
  );
}

export default async function PeoplePage() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    redirect("/login");
  }

  const [{ data: entryData }, { data: petTopicData }, { data: factData }] =
    await Promise.all([
      supabase
        .from("entries")
        .select(
          "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,is_crisis,created_at,updated_at",
        )
        .eq("user_id", claims.sub)
        .order("created_at", { ascending: false }),
      supabase
        .from("topics")
        .select(
          "id,user_id,type,name,first_mentioned_at,last_mentioned_at,mention_count,facts,created_at,updated_at",
        )
        .eq("user_id", claims.sub)
        .eq("type", "pet"),
      supabase
        .from("profile_facts")
        .select("id,user_id,kind,subject,text,importance,pinned,source_entry_id,source_message_ids,first_observed_at,last_observed_at,created_at,updated_at")
        .eq("user_id", claims.sub),
    ]);

  const people = buildPeople(
    cleanEntries((entryData ?? []) as Entry[]),
    (petTopicData ?? []) as Topic[],
    (factData ?? []) as ProfileFact[],
  );

  return (
    <main className="min-h-dvh bg-[#f7f4ef] text-neutral-950">
      <header className="border-b border-neutral-200 bg-[#f7f4ef]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">人物</h1>
            <p className="mt-1 text-xs text-neutral-500">
              选一个人，看 ta 相关的记录
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/archive">档案</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/">回到聊天</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        {people.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-12 text-center">
            <p className="text-sm text-neutral-500">
              还没有认识的人。多聊几次，提到的人会自动出现在这里。
            </p>
          </div>
        ) : (
          <>
            <Section
              title="人物"
              people={people.filter((person) => person.type === "person")}
            />
            <Section
              title="宠物"
              people={people.filter((person) => person.type === "pet")}
            />
            <Section
              title="地点"
              people={people.filter((person) => person.type === "place")}
            />
          </>
        )}
      </section>
    </main>
  );
}

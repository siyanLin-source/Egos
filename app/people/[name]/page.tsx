import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cleanEntries } from "@/lib/archive/clean-entries";
import {
  buildPeople,
  canonicalPersonName,
  type PersonView,
} from "@/lib/archive/people";
import { createClient } from "@/lib/supabase/server";
import type { Entry, ProfileFact, Topic } from "@/lib/types";

const TYPE_LABELS: Record<PersonView["type"], string> = {
  person: "人物",
  pet: "宠物",
  place: "地点",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

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

  const facts = (factData ?? []) as ProfileFact[];
  const canonical = canonicalPersonName(decoded, facts) ?? decoded;
  const person = buildPeople(
    cleanEntries((entryData ?? []) as Entry[]),
    (petTopicData ?? []) as Topic[],
    facts,
  ).find((candidate) => candidate.name === canonical);

  return (
    <main className="min-h-dvh bg-[#f7f4ef] text-neutral-950">
      <header className="border-b border-neutral-200 bg-[#f7f4ef]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{canonical}</h1>
            {person ? (
              <span className="rounded-full bg-[#e7efe7] px-2.5 py-1 text-xs font-medium text-[#256f5b]">
                {TYPE_LABELS[person.type]}
              </span>
            ) : null}
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/people">人物</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6">
        {!person || person.records.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-12 text-center">
            <p className="text-sm text-neutral-500">
              还没有关于「{canonical}」的记录。
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-neutral-500">
              {person.records.length} 条相关记录
            </p>
            <div className="space-y-3">
              {person.records.map((record, index) => {
                const card = (
                  <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-neutral-300 hover:shadow-md">
                    {record.category ? (
                      <span className="mb-2 inline-block rounded-full bg-[#e7efe7] px-2 py-0.5 text-xs font-medium text-[#256f5b]">
                        {record.category}
                      </span>
                    ) : null}
                    <p className="text-[15px] leading-6 text-neutral-950">
                      {record.text}
                    </p>
                    <p className="mt-2 text-xs text-neutral-400">
                      {formatDate(record.created_at)}
                    </p>
                  </div>
                );

                return record.entryId ? (
                  <Link key={record.entryId} href={`/archive/${record.entryId}`} className="block">
                    {card}
                  </Link>
                ) : (
                  <div key={`${record.text}-${index}`}>{card}</div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

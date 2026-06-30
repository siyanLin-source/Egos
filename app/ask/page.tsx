import { redirect } from "next/navigation";

import { AskView } from "@/components/ask/ask-view";
import { createClient } from "@/lib/supabase/server";

export default async function AskPage() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    redirect("/login");
  }

  return <AskView />;
}

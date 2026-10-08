import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

/** A10: /meeting/{id} always lands in the lobby, query string preserved (as=host, intent=share). */
export default async function MeetingIndex({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else if (value !== undefined) query.set(key, value);
  }
  const qs = query.toString();
  redirect(`/meeting/${id}/lobby${qs ? `?${qs}` : ""}`);
}

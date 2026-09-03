import { redirect } from "next/navigation";

/** Module unifié — voir lib/vocabulary.ts. L'identifiant est conservé. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}`);
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { getServerSession } from "@/lib/session-server";
import { createClient } from "@/lib/supabase/server";
import { isDemo, DEMO_PODCASTS } from "@/lib/demo";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  image_url: string | null;
  active: boolean;
};

export default async function PodcastsPage() {
  const session = await getServerSession();
  if (!session) redirect("/pending");

  let rows: Row[];
  if (isDemo(session)) {
    // Test/demo users see only fake shows.
    rows = DEMO_PODCASTS.map((p) => ({
      id: p.id,
      title: p.title,
      subtitle: null,
      author: p.author,
      image_url: null,
      active: true,
    }));
  } else {
    const supabase = createClient();
    const { data: podcasts } = await supabase
      .from("podcast")
      .select("id, title, subtitle, author, image_url, active")
      .eq("active", true)
      .order("title");
    rows = (podcasts ?? []) as Row[];
  }

  return (
    <div className="animate-rise space-y-10">
      <div className="pt-4">
        <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
          Podcasts
        </h1>
        <p className="text-[14px] text-ink-500 mt-1.5">
          {rows.length} {rows.length === 1 ? "show" : "shows"} visible to your
          account.
        </p>
      </div>

      <Card>
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-ink-500">
              No podcasts visible to you yet.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Show</TH>
                  <TH>Author</TH>
                  <TH>Status</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium">
                      <div className="flex items-center gap-2.5">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.image_url}
                            alt=""
                            className="w-8 h-8 rounded object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded bg-ink-100 text-ink-500 flex items-center justify-center text-[10px] font-semibold">
                            {p.title.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="text-ink-900">{p.title}</div>
                          {p.subtitle ? (
                            <div className="text-xs text-ink-500 truncate max-w-md">
                              {p.subtitle}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TD>
                    <TD className="text-ink-700">{p.author ?? "—"}</TD>
                    <TD>
                      {p.active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Inactive</Badge>
                      )}
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/podcasts/${p.id}`}
                        className="text-xs font-medium text-brand-dark hover:underline"
                      >
                        Open →
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

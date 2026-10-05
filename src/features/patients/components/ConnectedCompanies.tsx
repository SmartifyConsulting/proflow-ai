import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LABELS: Record<string, string> = {
  basic: "Basic details (name, date of birth, ID, medical aid)",
  medical: "Medical summary (allergies, conditions, chronic medication)",
  documents: "Claims documents (invoices, prescriptions, certificates, admissions)",
  consultations: "Consultation summaries (never recordings or transcripts)",
};

const db = supabase as any;

/** Patient-facing list of outside companies requesting or holding access to their information. */
export function ConnectedCompanies({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: requests = [] } = useQuery({
    queryKey: ["partner-requests", userId],
    queryFn: async () => {
      const { data } = await db.from("partner_access_requests")
        .select("id, categories, purpose, reference, status, expires_at, created_at, api_partners(name)")
        .eq("patient_user_id", userId).order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });
  const { data: log = [] } = useQuery({
    queryKey: ["partner-log", userId],
    queryFn: async () => {
      const { data } = await db.from("partner_access_log")
        .select("id, category, endpoint, created_at, api_partners(name)")
        .eq("patient_user_id", userId).order("created_at", { ascending: false }).limit(20);
      return (data ?? []) as any[];
    },
  });

  const respond = async (id: string, status: "approved" | "declined" | "revoked") => {
    const { error } = await db.from("partner_access_requests").update({ status }).eq("id", id);
    if (error) return toast({ title: "Could not update", description: error.message, variant: "destructive" });
    toast({ title: status === "approved" ? "Access approved" : status === "declined" ? "Request declined" : "Access withdrawn" });
    qc.invalidateQueries({ queryKey: ["partner-requests", userId] });
  };

  if (requests.length === 0) return null;

  return (
    <Card className="border-2 border-primary">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" />Connected Companies</CardTitle>
        <p className="text-xs text-muted-foreground">Outside companies can only see what you approve. They can never change your information.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.map((r) => {
          const expired = r.status === "approved" && r.expires_at && new Date(r.expires_at) < new Date();
          const status = expired ? "expired" : r.status;
          return (
            <div key={r.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{r.api_partners?.name ?? "Company"}</p>
                <Badge variant={status === "approved" ? "default" : "secondary"} className="capitalize">{status}</Badge>
              </div>
              {r.purpose && <p className="text-xs text-muted-foreground">Reason: {r.purpose}{r.reference ? ` (${r.reference})` : ""}</p>}
              <ul className="list-disc pl-5 text-xs">{r.categories.map((c: string) => <li key={c}>{LABELS[c] ?? c}</li>)}</ul>
              {status === "approved" && r.expires_at && <p className="text-xs text-muted-foreground">Access until {new Date(r.expires_at).toLocaleDateString()}</p>}
              <div className="flex gap-2">
                {status === "pending" && <>
                  <Button size="sm" className="min-h-[44px]" onClick={() => respond(r.id, "approved")}>Approve</Button>
                  <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => respond(r.id, "declined")}>Decline</Button>
                </>}
                {status === "approved" && <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => respond(r.id, "revoked")}>Withdraw access</Button>}
              </div>
            </div>
          );
        })}
        {log.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Who viewed what</p>
            <ul className="space-y-1 text-xs">
              {log.map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span>{l.api_partners?.name ?? "Company"} · {l.category ? LABELS[l.category]?.split(" (")[0] : "Access request"}</span>
                  <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

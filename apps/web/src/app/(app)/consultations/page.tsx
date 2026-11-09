"use client";
import { useQuery } from "@tanstack/react-query";
import type { Paginated } from "@vcms/shared";
import { enumLabel } from "@vcms/shared";
import { CalendarClock, ListChecks, Plus, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { DataTable } from "@/components/data-table";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
} from "@/components/page";
import { QueueBoard, useQueue } from "@/components/scheduling/queue-board";
import { StartConsultationDialog } from "@/components/clinical/start-consultation-dialog";
import { RequirePermission } from "@/components/require";
import { SearchInput } from "@/components/search-input";
import { AlertChip } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/input";
import { tabListClass, tabTriggerClass } from "@/components/ui/tabs";
import { dashboardRole } from "@/components/dashboard/quick-actions";
import { useUrlState } from "@/hooks/use-url-state";
import { api, qs } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { EncounterRow } from "@/lib/types";
import { cn } from "@/lib/utils";

function ConsultationsList() {
  const router = useRouter();
  const { can } = useSession();
  const url = useUrlState();
  // ?start=1 (e.g. "See a walk-in" on the dashboard) opens the start window straight away.
  const [start, setStart] = useState(() => url.get("start") === "1");
  // Vets see their own consultations first; everyone can switch to all.
  const mineDefault = dashboardRole((p) => can(p)) === "vet" ? "true" : "false";
  const params = {
    q: url.get("q"),
    status: url.get("status", "OPEN"),
    mine: url.get("mine", mineDefault) === "true" ? "true" : undefined,
    page: Number(url.get("page", "1")),
    pageSize: Number(url.get("pageSize", "25")),
  };
  // Today's patients (expected and waiting) first; all consultations on the other tab.
  const view = url.get("view", "today") === "all" ? "all" : "today";
  const queue = useQueue();
  const todayCount =
    (queue.data?.expected.length ?? 0) + (queue.data?.waiting.length ?? 0);
  const query = useQuery({
    queryKey: ["encounters", params],
    queryFn: () => api.get<Paginated<EncounterRow>>(`/encounters${qs(params)}`),
    placeholderData: (p) => p,
    enabled: view === "all",
  });
  return (
    <>
      <PageHeader
        help="consultation"
        title="Consultations"
        description={
          view === "today"
            ? "Patients expected today and waiting to be seen — start a consultation from here"
            : "Consultations and whether their notes are finished"
        }
        actions={
          can("clinical.write") && (
            <Button size="sm" onClick={() => setStart(true)}>
              <Plus /> Start consultation
            </Button>
          )
        }
      />
      <div
        className={cn(tabListClass, "mb-4 w-fit")}
        role="tablist"
        aria-label="Consultations"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "today"}
          className={tabTriggerClass(view === "today")}
          onClick={() => url.set({ view: undefined })}
        >
          <CalendarClock className="h-4 w-4" /> Today’s patients
          {todayCount > 0 && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs font-semibold tabular text-primary">
              {todayCount}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "all"}
          className={tabTriggerClass(view === "all")}
          onClick={() => url.set({ view: "all" })}
        >
          <ListChecks className="h-4 w-4" /> All consultations
        </button>
      </div>
      {view === "today" ? (
        queue.isLoading ? (
          <LoadingRows />
        ) : queue.error ? (
          <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
        ) : (
          <>
            <QueueBoard
              columns={["expected", "waiting"]}
              allowStart
              className="lg:grid-cols-2"
            />
            <p className="mt-2 text-right text-2xs text-muted-foreground">
              Refreshes every 30 seconds · waiting list sorted by triage
              priority, then arrival time
            </p>
          </>
        )
      ) : (
        <Card>
          <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
            <SearchInput
              value={params.q}
              onChange={(q) => url.set({ q, page: 1 })}
              placeholder="Patient, client or complaint"
            />
            <NativeSelect
              aria-label="Status"
              className="sm:w-40"
              value={params.status}
              onChange={(e) => url.set({ status: e.target.value, page: 1 })}
            >
              <option value="OPEN">Open</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="ALL">All</option>
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={params.mine === "true"}
                onCheckedChange={(v) =>
                  url.set({ mine: v === true ? "true" : "false", page: 1 })
                }
              />{" "}
              Only mine
            </label>
          </div>
          <DataTable
            query={query}
            rowKey={(e) => e.id}
            onRowClick={(e) => router.push(`/consultations/${e.id}`)}
            page={params.page}
            pageSize={params.pageSize}
            onPage={(page) => url.set({ page })}
            onPageSize={(pageSize) => url.set({ pageSize, page: 1 })}
            empty={
              <EmptyState icon={Stethoscope} title="No consultations match" />
            }
            columns={[
              {
                key: "patient",
                header: "Patient",
                cell: (e) => (
                  <div>
                    <Link
                      href={`/consultations/${e.id}`}
                      className="font-medium hover:underline"
                    >
                      {e.patient.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {e.patient.species.name} · {e.client.displayName}
                    </p>
                  </div>
                ),
              },
              {
                key: "visit",
                header: "Visit",
                cell: (e) => (
                  <div className="text-sm">
                    {enumLabel(e.type)}
                    {e.chiefComplaint && (
                      <p className="max-w-[260px] truncate text-xs text-muted-foreground">
                        {e.chiefComplaint}
                      </p>
                    )}
                  </div>
                ),
              },
              {
                key: "dx",
                header: "Diagnoses",
                cell: (e) => (
                  <span className="text-xs">
                    {e.diagnoses.map((d) => d.term).join(", ") || "—"}
                  </span>
                ),
              },
              {
                key: "clin",
                header: "Clinician",
                cell: (e) => (
                  <span className="text-sm">{e.clinician?.name ?? "—"}</span>
                ),
              },
              {
                key: "when",
                header: "Started",
                cell: (e) => (
                  <span className="whitespace-nowrap text-xs">
                    {fmtDateTime(e.startedAt)}
                  </span>
                ),
              },
              {
                key: "notes",
                header: "Notes",
                cell: (e) =>
                  e.noteStatus === "SIGNED" ? (
                    <Badge variant="success">Signed</Badge>
                  ) : e.noteStatus === "UNSIGNED" ? (
                    <Badge variant="warning">Unsigned</Badge>
                  ) : (
                    <Badge variant="outline">None</Badge>
                  ),
              },
              {
                key: "alerts",
                header: "",
                cell: (e) => (
                  <div className="flex gap-1">
                    {e.patient.alerts
                      .filter((a) => a.severity === "CRITICAL")
                      .slice(0, 1)
                      .map((a) => (
                        <AlertChip key={a.id} alert={a} />
                      ))}
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (e) => (
                  <Badge
                    variant={
                      e.status === "OPEN"
                        ? "warning"
                        : e.status === "COMPLETED"
                          ? "success"
                          : "outline"
                    }
                  >
                    {enumLabel(e.status)}
                  </Badge>
                ),
              },
            ]}
          />
        </Card>
      )}
      <StartConsultationDialog open={start} onOpenChange={setStart} />
    </>
  );
}

export default function ConsultationsPage() {
  return (
    <RequirePermission anyOf={["clinical.read"]}>
      <Suspense>
        <ConsultationsList />
      </Suspense>
    </RequirePermission>
  );
}

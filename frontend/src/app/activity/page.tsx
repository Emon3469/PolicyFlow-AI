import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityLog } from "@/components/activity/activity-log";

export const metadata: Metadata = { title: "Audit Log" };

export default function ActivityPage() {
  return (
    <Suspense fallback={null}>
      <ActivityLog />
    </Suspense>
  );
}

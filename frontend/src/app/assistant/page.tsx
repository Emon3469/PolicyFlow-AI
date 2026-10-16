import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatView } from "@/components/chat/chat-view";

export const metadata: Metadata = { title: "Assistant" };

export default function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <ChatView />
    </Suspense>
  );
}

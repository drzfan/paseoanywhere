import { useEffect } from "react";
import { useRouter } from "expo-router";
import { AgentListScreen } from "../ui/AgentList";
import { getLastAgentId } from "../settings/storage";
import { ensureBoot } from "./boot";

/** One-shot: cold start jumps straight into the last conversation. */
let autoRedirectConsumed = false;

export default function ConversationsScreen() {
  const router = useRouter();

  useEffect(() => {
    void ensureBoot();
    if (autoRedirectConsumed) return;
    autoRedirectConsumed = true;
    void getLastAgentId().then((agentId) => {
      // Replace (not push) so Back from the chat returns to this list once.
      if (agentId) {
        router.replace({ pathname: "/chat/[agentId]", params: { agentId } });
      }
    });
  }, [router]);

  return <AgentListScreen />;
}

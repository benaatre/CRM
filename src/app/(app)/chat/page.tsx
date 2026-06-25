import { requireUser } from "@/lib/auth-guards";
import { getChatPeers } from "@/lib/actions/chat";
import { ChatView } from "@/components/chat/chat-view";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requireUser();
  const peers = await getChatPeers();
  return <ChatView currentUserId={user.id} currentUserName={user.name ?? "أنا"} peers={peers} />;
}

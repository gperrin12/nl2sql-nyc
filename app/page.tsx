import { isAuthenticated } from "@/lib/auth";
import { HomeClient } from "@/components/HomeClient";

export default async function Home() {
  const authed = await isAuthenticated();
  return <HomeClient initialAuthed={authed} />;
}

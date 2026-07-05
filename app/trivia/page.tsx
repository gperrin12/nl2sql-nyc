import { redirect } from "next/navigation";

/** Legacy /trivia URL — trivia is now the site home at /. */
export default function TriviaPage() {
  redirect("/");
}

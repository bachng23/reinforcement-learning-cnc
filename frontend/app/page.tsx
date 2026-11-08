import { redirect } from "next/navigation";

export default function Home() {
  redirect(process.env.NEXT_PUBLIC_RESEARCH_ENABLED === "false" ? "/operations" : "/simulation");
}

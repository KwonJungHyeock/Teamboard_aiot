import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import MyTasks from "@/components/ed/screens/MyTasks";
import "../../ed-my.css";

export const dynamic = "force-dynamic";

export default async function V3My() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return <MyTasks />;
}

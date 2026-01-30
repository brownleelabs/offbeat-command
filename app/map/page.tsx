import { redirect } from "next/navigation";

/** Deep link: /map opens dashboard with Map tab active. */
export default function MapPage() {
  redirect("/?tab=map");
}

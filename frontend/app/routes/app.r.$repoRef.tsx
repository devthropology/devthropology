import { Outlet, useOutletContext } from "react-router";
import type { RepositoryDetails } from "./types";

export default function RepoScopedLayout() {
  const context = useOutletContext<{ repository: RepositoryDetails | null }>();
  return <Outlet context={context} />;
}

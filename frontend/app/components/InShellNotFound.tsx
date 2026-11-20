import { useNavigate } from "react-router";
import { Button } from "./ui/button";

export function InShellNotFound({
  title = "Page not found",
  message = "This route is not available.",
}: {
  title?: string;
  message?: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-white/10 bg-slate-950/40 px-6 text-center">
      <div className="max-w-md space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-white">{title}</h1>
          <p className="text-sm text-slate-300">{message}</p>
        </div>
        <Button
          type="button"
          onClick={() => {
            void navigate("/app");
          }}
        >
          Go Home
        </Button>
      </div>
    </div>
  );
}

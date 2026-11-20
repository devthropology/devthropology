import { Form } from "react-router";

export function GithubSignInButton({ redirectTo = "" }: { redirectTo?: string }) {
  return (
    <Form method="post" action="/auth/github" reloadDocument>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <button
        type="submit"
        className="flex w-full items-center justify-center gap-3 rounded-md border border-transparent bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-5 w-5 shrink-0"
        >
          <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.768-.244.768-.542 0-.267-.01-.974-.015-1.912-3.13.68-3.791-1.508-3.791-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.023-.7.078-.686.078-.686 1.131.08 1.726 1.161 1.726 1.161 1.005 1.722 2.637 1.224 3.28.936.102-.728.393-1.224.715-1.506-2.499-.284-5.126-1.25-5.126-5.565 0-1.23.44-2.233 1.16-3.02-.116-.284-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.154A10.79 10.79 0 0 1 12 6.18c.956.004 1.918.129 2.817.379 2.147-1.457 3.09-1.154 3.09-1.154.615 1.55.228 2.696.112 2.98.722.787 1.158 1.79 1.158 3.02 0 4.326-2.631 5.278-5.138 5.557.404.35.765 1.043.765 2.1 0 1.517-.014 2.74-.014 3.112 0 .3.202.65.774.54A11.252 11.252 0 0 0 12 .75Z" />
        </svg>
        Continue with GitHub
      </button>
    </Form>
  );
}

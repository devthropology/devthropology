import { Link, useLoaderData } from "react-router";
import { Folder, Plus, User } from "lucide-react";
import { useState, useEffect } from "react";
import { API_URL, authenticatedFetch } from "../config";

interface Workspace {
  workspaceId: string;
  name: string;
  slug: string;
  workspaceType: string;
}

export type SettingsLoaderData = {
  user: {
    username: string;
    role: string;
    token: string;
  };
};

export default function AdminCenter() {
  const { user } = useLoaderData<SettingsLoaderData>();
  const [org, setOrg] = useState("");
  const [repo, setRepo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // New state for user creation form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [userMessage, setUserMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // State for workspace creation form
  const [workspaceName, setWorkspaceName] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // State for workspaces list and repository onboarding
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);

  // Fetch workspaces on mount
  useEffect(() => {
    const fetchWorkspaces = async () => {
      try {
        const response = await authenticatedFetch(`${API_URL}/api/workspaces`, user.token);
        if (response.ok) {
          const data = (await response.json()) as Workspace[];
          setWorkspaces(data);
          if (data.length > 0) {
            setSelectedWorkspaceId(data[0].workspaceId);
          }
        }
      } catch {
        console.error("Failed to fetch workspaces");
      } finally {
        setIsLoadingWorkspaces(false);
      }
    };
    void fetchWorkspaces();
  }, [user.token]);

  const handleOnboardRepository = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    if (!selectedWorkspaceId) {
      setMessage({ type: "error", text: "Please select a workspace" });
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await authenticatedFetch(`${API_URL}/api/repository`, user.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          org: org.trim(),
          name: repo.trim(),
          workspaceId: selectedWorkspaceId,
        }),
      });

      if (response.ok) {
        setMessage({
          type: "success",
          text: `Successfully onboarded repository ${org}/${repo}`,
        });
        setOrg("");
        setRepo("");
      } else {
        const error = (await response.json()) as { error?: string };
        let errorMessage = "Failed to onboard repository";

        if (response.status === 409) {
          errorMessage = `Repository ${org}/${repo} already exists`;
        } else if (response.status === 400) {
          errorMessage = error.error || "Invalid repository information provided";
        } else if (response.status === 401) {
          errorMessage = "Authentication failed. Please log in again.";
        } else if (response.status === 403) {
          errorMessage = error.error || "You don't have access to this workspace";
        } else if (response.status >= 500) {
          errorMessage = "Server error occurred. Please try again later.";
        } else {
          errorMessage = error.error || errorMessage;
        }

        setMessage({ type: "error", text: errorMessage });
      }
    } catch {
      setMessage({ type: "error", text: "Network error occurred" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingUser(true);
    setUserMessage(null);

    try {
      const response = await authenticatedFetch(`${API_URL}/api/auth/users`, user.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        }),
      });

      if (response.ok) {
        setUserMessage({
          type: "success",
          text: `Successfully created user ${newUsername}`,
        });
        setNewUsername("");
        setNewPassword("");
        setNewRole("user");
      } else {
        const error = (await response.json()) as { error?: string };
        let errorMessage = "Failed to create user";

        if (response.status === 403) {
          errorMessage = "Superuser role required to create users";
        } else if (response.status === 400) {
          errorMessage = error.error || "Invalid user information provided";
        } else if (response.status === 401) {
          errorMessage = "Authentication failed. Please log in again.";
        } else if (response.status >= 500) {
          errorMessage = "Server error occurred. Please try again later.";
        } else {
          errorMessage = error.error || errorMessage;
        }

        setUserMessage({ type: "error", text: errorMessage });
      }
    } catch {
      setUserMessage({ type: "error", text: "Network error occurred" });
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingWorkspace(true);
    setWorkspaceMessage(null);

    try {
      const response = await authenticatedFetch(`${API_URL}/api/workspaces`, user.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: workspaceName.trim(),
        }),
      });

      if (response.ok) {
        const newWorkspace = (await response.json()) as Workspace;
        setWorkspaceMessage({
          type: "success",
          text: `Successfully created workspace "${workspaceName}"`,
        });
        setWorkspaceName("");
        // Add the new workspace to the list and select it
        setWorkspaces((prev) => [...prev, newWorkspace]);
        setSelectedWorkspaceId(newWorkspace.workspaceId);
      } else {
        const error = (await response.json()) as { error?: string };
        let errorMessage = "Failed to create workspace";

        if (response.status === 403) {
          errorMessage = error.error || "You don't have permission to create workspaces";
        } else if (response.status === 400) {
          errorMessage = error.error || "Invalid workspace information provided";
        } else if (response.status === 401) {
          errorMessage = "Authentication failed. Please log in again.";
        } else if (response.status >= 500) {
          errorMessage = "Server error occurred. Please try again later.";
        } else {
          errorMessage = error.error || errorMessage;
        }

        setWorkspaceMessage({ type: "error", text: errorMessage });
      }
    } catch {
      setWorkspaceMessage({ type: "error", text: "Network error occurred" });
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl text-sm">
      <div>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-white">Admin center</h1>

        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-white mb-2">Reports</h2>
          <p className="text-gray-400 mb-4">
            Combine author and reviewer activity across repositories in a workspace.
          </p>
          <Link
            to="/app/reports"
            className="text-blue-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            Combined Reports
          </Link>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
            <Plus className="mr-2 h-5 w-5" />
            Onboard Repository
          </h2>

          <div className="space-y-4">
            <form onSubmit={handleOnboardRepository} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="org" className="block text-sm font-medium text-gray-300 mb-2">
                    Organization
                  </label>
                  <input
                    type="text"
                    id="org"
                    value={org}
                    onChange={(e) => setOrg(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., tailscale"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="repo" className="block text-sm font-medium text-gray-300 mb-2">
                    Repository
                  </label>
                  <input
                    type="text"
                    id="repo"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., tailscale"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="workspace"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Workspace
                  </label>
                  <select
                    id="workspace"
                    value={selectedWorkspaceId}
                    onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                    disabled={isLoadingWorkspaces || workspaces.length === 0}
                  >
                    {isLoadingWorkspaces ? (
                      <option value="">Loading...</option>
                    ) : workspaces.length === 0 ? (
                      <option value="">No workspaces available</option>
                    ) : (
                      workspaces.map((ws) => (
                        <option key={ws.workspaceId} value={ws.workspaceId}>
                          {ws.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || isLoadingWorkspaces || workspaces.length === 0}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>{isSubmitting ? "Onboarding..." : "Onboard Repository"}</span>
              </button>
            </form>

            {message && (
              <div
                className={`p-3 rounded-md text-sm ${
                  message.type === "success"
                    ? "bg-green-900/50 border border-green-700 text-green-200"
                    : "bg-red-900/50 border border-red-700 text-red-200"
                }`}
              >
                {message.text}
              </div>
            )}

            {workspaces.length === 0 && !isLoadingWorkspaces && (
              <div className="p-3 rounded-md text-sm bg-yellow-900/50 border border-yellow-700 text-yellow-200">
                No workspaces available. Create a workspace below before onboarding repositories.
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
            <Folder className="mr-2 h-5 w-5" />
            Create Workspace
          </h2>

          <div className="space-y-4">
            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div>
                <label
                  htmlFor="workspaceName"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  Workspace Name
                </label>
                <input
                  type="text"
                  id="workspaceName"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="w-full max-w-md px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., My Team"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isCreatingWorkspace}
                className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
              >
                <Folder className="h-4 w-4" />
                <span>{isCreatingWorkspace ? "Creating..." : "Create Workspace"}</span>
              </button>
            </form>

            {workspaceMessage && (
              <div
                className={`p-3 rounded-md text-sm ${
                  workspaceMessage.type === "success"
                    ? "bg-green-900/50 border border-green-700 text-green-200"
                    : "bg-red-900/50 border border-red-700 text-red-200"
                }`}
              >
                {workspaceMessage.text}
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
            <User className="mr-2 h-5 w-5" />
            Create User
          </h2>

          <div className="space-y-4">
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="newUsername"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Username
                  </label>
                  <input
                    type="text"
                    id="newUsername"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., newuser"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="newPassword"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Password
                  </label>
                  <input
                    type="password"
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter password"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="newRole" className="block text-sm font-medium text-gray-300 mb-2">
                    Role
                  </label>
                  <select
                    id="newRole"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="user">User</option>
                    <option value="demo">Demo</option>
                    <option value="superuser">Superuser</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isCreatingUser}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
              >
                <User className="h-4 w-4" />
                <span>{isCreatingUser ? "Creating..." : "Create User"}</span>
              </button>
            </form>

            {userMessage && (
              <div
                className={`p-3 rounded-md text-sm ${
                  userMessage.type === "success"
                    ? "bg-green-900/50 border border-green-700 text-green-200"
                    : "bg-red-900/50 border border-red-700 text-red-200"
                }`}
              >
                {userMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

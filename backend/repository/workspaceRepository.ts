export interface Workspace {
  workspaceId: string;
  name: string;
  slug: string;
  workspaceType: "demo" | "system" | "user";
  createdBy: string | null;
  createdAt: Date;
}

export interface WorkspaceMember {
  workspaceId: string;
  authUserId: string;
  workspaceRole: "owner" | "member";
  joinedAt: Date;
}

export interface WorkspaceRepositoryLink {
  workspaceId: string;
  repositoryId: number;
  addedBy: string | null;
  addedAt: Date;
}

export interface IWorkspaceRepository {
  // For a user, which repository_ids can they access?
  getAccessibleRepositoryIds(userId: string): Promise<number[]>;

  // Can a specific user access a specific repository?
  canUserAccessRepository(
    userId: string,
    repositoryId: number,
  ): Promise<boolean>;

  // Get all workspaces a user is a member of
  getUserWorkspaces(userId: string): Promise<Workspace[]>;

  // Get all workspaces (for superuser)
  getAllWorkspaces(): Promise<Workspace[]>;

  // Get a workspace by ID
  getWorkspaceById(workspaceId: string): Promise<Workspace | null>;

  // Check if user is a member of a workspace
  isUserInWorkspace(userId: string, workspaceId: string): Promise<boolean>;

  // Get the demo workspace (for auto-joining new users)
  getDemoWorkspace(): Promise<Workspace | null>;

  // Add a user to a workspace
  addUserToWorkspace(
    workspaceId: string,
    userId: string,
    role: "owner" | "member",
  ): Promise<void>;

  // Create a new workspace (for user signup)
  createWorkspace(
    name: string,
    slug: string,
    workspaceType: "demo" | "system" | "user",
    createdBy: string | null,
  ): Promise<Workspace>;

  // Add a repository to a workspace
  addRepositoryToWorkspace(
    workspaceId: string,
    repositoryId: number,
    addedBy: string | null,
  ): Promise<void>;

  // Get repositories in a workspace
  getWorkspaceRepositories(workspaceId: string): Promise<number[]>;
}

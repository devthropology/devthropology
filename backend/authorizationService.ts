import { AuthUser } from "./models/auth.ts";
import { IWorkspaceRepository } from "./repository/workspaceRepository.ts";
import { isTransientDatabaseConnectionError } from "./util/isTransientDatabaseConnectionError.ts";

/**
 * AuthorizationService: Handles repository access permissions via workspaces
 *
 * Access Model:
 * - superuser: Bypasses all checks, can access everything
 * - user: Access to repositories in workspaces they're a member of
 * - demo: Read-only access to demo workspace repositories only
 *
 * Workspace Types:
 * - demo: Public showcase repos (visible to demo and user roles)
 * - system: Internal testing repos (superuser only)
 * - user: Customer/personal workspaces (member-based access)
 */
export class AuthorizationService {
  private workspaceRepository: IWorkspaceRepository | null;

  constructor(workspaceRepository?: IWorkspaceRepository) {
    this.workspaceRepository = workspaceRepository ?? null;
  }

  /**
   * Check if service has been initialized with a workspace repository
   */
  isInitialized(): boolean {
    return this.workspaceRepository !== null;
  }

  /**
   * Check if user can access a specific repository by ID
   *
   * Access rules:
   * 1. superuser: always true (bypass)
   * 2. user/demo: true if they're a member of any workspace containing this repo
   */
  async canAccessRepositoryById(
    user: AuthUser,
    repositoryId: number,
  ): Promise<boolean> {
    try {
      // Superuser bypasses all access checks
      if (user.role === "superuser") {
        return true;
      }

      // If workspace repository not initialized, deny by default (safe fallback)
      if (!this.workspaceRepository) {
        console.warn(
          "AuthZ: Workspace repository not initialized, denying access",
        );
        return false;
      }

      // Check workspace membership
      return await this.workspaceRepository.canUserAccessRepository(
        user.userId,
        repositoryId,
      );
    } catch (error) {
      console.error(
        `AuthZ: Error checking repository access for user ${user.userId}:`,
        error,
      );
      if (isTransientDatabaseConnectionError(error)) {
        throw error;
      }
      return false;
    }
  }

  /**
   * Get all repository IDs a user can access
   *
   * Returns:
   * - superuser: null (meaning "all repos" - caller should handle this)
   * - user/demo: array of repository IDs from their workspaces
   */
  async getAccessibleRepositoryIds(user: AuthUser): Promise<number[] | null> {
    try {
      // Superuser can access everything - return null to indicate "no filter"
      if (user.role === "superuser") {
        return null;
      }

      // If workspace repository not initialized, return empty (no access)
      if (!this.workspaceRepository) {
        console.warn(
          "AuthZ: Workspace repository not initialized, returning empty access",
        );
        return [];
      }

      return await this.workspaceRepository.getAccessibleRepositoryIds(
        user.userId,
      );
    } catch (error) {
      console.error(
        `AuthZ: Error getting accessible repositories for user ${user.userId}:`,
        error,
      );
      if (isTransientDatabaseConnectionError(error)) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Validate repository access (combines existence check + permission check)
   *
   * Note: repositoryId is now required. Use getRepositoryIdByName if you have a name.
   */
  async validateRepositoryAccess(
    user: AuthUser,
    repositoryId: number,
  ): Promise<{
    canAccess: boolean;
    repositoryExists: boolean;
    error?: string;
  }> {
    try {
      const canAccess = await this.canAccessRepositoryById(user, repositoryId);

      return {
        canAccess,
        repositoryExists: true, // Caller should verify existence separately if needed
      };
    } catch (error) {
      console.error(`AuthZ: Error validating repository access:`, error);
      return {
        canAccess: false,
        repositoryExists: false,
        error: "Internal authorization error",
      };
    }
  }

  /**
   * Check if user can import repositories (create new repos in their workspace)
   *
   * Only 'user' role can import. 'demo' is read-only.
   */
  canImportRepositories(user: AuthUser): boolean {
    return user.role === "superuser" || user.role === "user";
  }

  /**
   * Get workspaces the user is a member of
   */
  async getUserWorkspaces(user: AuthUser) {
    if (!this.workspaceRepository) {
      console.warn(
        "AuthZ: Workspace repository not initialized, returning empty workspaces",
      );
      return [];
    }

    if (user.role === "superuser") {
      // Superuser could see all workspaces, but for now return their memberships
      // Could add getAllWorkspaces() method if needed
    }
    return await this.workspaceRepository.getUserWorkspaces(user.userId);
  }
}

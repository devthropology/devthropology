import { IRepositoryRepository } from "../repository/repositoryRepository.ts";
import { RepositoryDetails } from "../models/dbTypes.ts";

export class RepositoryService {
  private repository: IRepositoryRepository;

  constructor(repository: IRepositoryRepository) {
    this.repository = repository;
  }

  async onboardRepository(
    org: string,
    name: string,
  ): Promise<RepositoryDetails> {
    // Validate input
    if (!org || !name) {
      throw new Error("Organization and repository name are required");
    }

    if (org.includes("/") || name.includes("/")) {
      throw new Error(
        "Organization and repository name cannot contain slashes",
      );
    }

    try {
      // Insert new repository (database UNIQUE constraint will handle duplicates)
      return await this.repository.insertRepository(org, name);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("duplicate key value")
      ) {
        throw new Error(`Repository ${org}/${name} already exists`);
      }
      throw error;
    }
  }

  async onboardRepositoryInWorkspace(
    org: string,
    name: string,
    workspaceId: string,
    addedBy: string | null,
  ): Promise<RepositoryDetails> {
    if (!workspaceId) {
      throw new Error("workspaceId is required");
    }

    // Reuse existing validation in onboardRepository path
    if (!org || !name) {
      throw new Error("Organization and repository name are required");
    }

    if (org.includes("/") || name.includes("/")) {
      throw new Error(
        "Organization and repository name cannot contain slashes",
      );
    }

    try {
      return await this.repository.insertRepositoryInWorkspace(
        org,
        name,
        workspaceId,
        addedBy,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("duplicate key value")
      ) {
        throw new Error(`Repository ${org}/${name} already exists`);
      }
      throw error;
    }
  }

  async getAllRepositories(): Promise<RepositoryDetails[]> {
    return await this.repository.getAllRepositories();
  }
}

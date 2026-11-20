import { AuthUser } from "./models/auth.ts";
import {
  AuthenticationIdentityService,
  AuthenticationResult,
} from "./services/authenticationIdentityService.ts";

export class AuthenticationService {
  constructor(
    private readonly identityService: AuthenticationIdentityService,
  ) {}

  async authenticateWithPassword(
    username: string,
    password: string,
  ): Promise<AuthenticationResult | null> {
    return await this.identityService.authenticateWithPassword(
      username,
      password,
    );
  }

  async validateToken(token: string): Promise<AuthUser | null> {
    return await this.identityService.validateToken(token);
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    return await this.identityService.getUserById(userId);
  }

  async listUsers(): Promise<AuthUser[]> {
    return await this.identityService.listUsers();
  }

  async getCacheStats() {
    const users = await this.identityService.listUsers();

    return {
      userCount: users.length,
      users,
    };
  }
}

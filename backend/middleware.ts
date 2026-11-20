import { Context, Next } from "hono";
import { AuthenticationService } from "./authenticationService.ts";
import { AuthUser } from "./models/auth.ts";
import { AuthorizationService } from "./authorizationService.ts";
import {
  isLegacyNumericRepositoryRef,
  resolveRepositoryRef,
} from "./repositoryPublicId.ts";
import { isTransientDatabaseConnectionError } from "./util/isTransientDatabaseConnectionError.ts";

/**
 * Authentication Middleware
 *
 * Validates Bearer token and populates c.user with authenticated user data
 * Returns 401 if token is invalid/missing
 */
export function createAuthMiddleware(
  authenticationService: Pick<AuthenticationService, "validateToken">,
) {
  return async (c: Context, next: Next) => {
    // Try Authorization header first, then fall back to auth-token cookie
    const authHeader = c.req.header("Authorization");
    let token: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7); // Remove "Bearer " prefix
    } else {
      // Extract token from auth-token cookie
      const cookieHeader = c.req.header("Cookie");
      if (cookieHeader) {
        const cookies = cookieHeader.split(";").map((c) => c.trim());
        const authTokenCookie = cookies.find((c) =>
          c.startsWith("auth-token="),
        );

        if (authTokenCookie) {
          token = authTokenCookie.split("=")[1];
        }
      }
    }

    if (!token) {
      console.log(
        "Auth: No valid token found in Authorization header or auth-token cookie",
      );
      return c.json({ error: "Authentication required" }, 401);
    }

    let user: AuthUser | null;
    try {
      user = await authenticationService.validateToken(token);
    } catch (error) {
      // Database errors may include credential-bearing query parameters.
      if (isTransientDatabaseConnectionError(error)) {
        console.error("Auth: Database temporarily unavailable");
        return c.json({ error: "Database temporarily unavailable" }, 503);
      }
      console.error("Auth: Token validation error");
      return c.json({ error: "Authentication service failed" }, 500);
    }
    if (!user) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
    c.set("user", user);
    // Downstream errors are not authentication failures.
    await next();
  };
}

/**
 * Authorization Middleware for repository access by ID
 *
 * Checks if authenticated user can access a repository by its ID.
 * Expects repositoryId to be extracted from URL params by the route handler.
 *
 * Note: Most endpoints extract repositoryId from URL and should call
 * authzService.canAccessRepositoryById() directly in the handler.
 * This middleware is for legacy compatibility.
 */
export function createAuthzMiddleware(authzService: AuthorizationService) {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as AuthUser;

    if (!user) {
      console.error(
        "AuthZ: No user in context - auth middleware must run first",
      );
      return c.json({ error: "Internal error: user not authenticated" }, 500);
    }

    // Superuser bypasses all authz checks
    if (user.role === "superuser") {
      await next();
      return;
    }

    // Try to get repositoryId from URL params
    const repositoryIdParam = c.req.param("repositoryId");
    if (repositoryIdParam) {
      const repositoryId = resolveRepositoryRef(repositoryIdParam);
      if (repositoryId !== null) {
        if (isLegacyNumericRepositoryRef(repositoryIdParam)) {
          console.info(
            `AuthZ: resolved legacy numeric repository ref ${repositoryIdParam}`,
          );
        }

        let canAccess: boolean;
        try {
          canAccess = await authzService.canAccessRepositoryById(
            user,
            repositoryId,
          );
        } catch (error) {
          if (isTransientDatabaseConnectionError(error)) {
            return c.json({ error: "Database temporarily unavailable" }, 503);
          }
          throw error;
        }
        if (!canAccess) {
          console.warn(
            `AuthZ: User ${user.username} (${user.userId}) denied access to repository ${repositoryId}`,
          );
          return c.json({ error: "Access denied" }, 403);
        }
      }
    }

    // If no repositoryId in URL, allow through (endpoint handles its own authz)
    await next();
  };
}

/**
 * Combined Auth + Authz Middleware
 *
 * Applies authentication first, then authorization.
 * For endpoints without repositoryId in URL, this just authenticates.
 * Repository filtering should be done in the endpoint handler using
 * authzService.getAccessibleRepositoryIds().
 */
export function createAuthAndAuthzMiddleware(
  authenticationService: AuthenticationService,
  authzService: AuthorizationService,
) {
  const authMiddleware = createAuthMiddleware(authenticationService);
  const authzMiddleware = createAuthzMiddleware(authzService);

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Track if auth succeeded
    let authPassed = false;

    // Run auth first
    const authResponse = await authMiddleware(c, () => {
      authPassed = true;
      return Promise.resolve();
    });

    // If auth returned a response (failed), return it
    if (!authPassed) {
      if (authResponse instanceof Response) {
        return authResponse;
      } else {
        return c.json({ error: "Authentication failed" }, 401);
      }
    }

    // Auth passed, now run authz
    return await authzMiddleware(c, next);
  };
}

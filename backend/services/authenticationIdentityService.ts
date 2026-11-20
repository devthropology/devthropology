import {
  AuthRepository,
  AuthUserRecord,
  CreateAuthUserParams,
} from "../repository/authRepository.ts";
import { AuthUser } from "../models/auth.ts";

interface AuthenticationIdentityServiceOptions {
  passwordPepper: string;
  pbkdf2Iterations?: number;
  pbkdf2KeyLengthBytes?: number;
}

export interface AuthenticationResult {
  user: AuthUser;
  token: string;
}

export class AuthenticationIdentityService {
  private readonly repository: AuthRepository;
  private readonly passwordPepper: string;
  private readonly pbkdf2Iterations: number;
  private readonly pbkdf2KeyLengthBytes: number;
  private readonly textEncoder = new TextEncoder();

  private static readonly HASH_SCHEME = "pbkdf2-sha256";
  private static readonly DEFAULT_PBKDF2_ITERATIONS = 200_000;
  private static readonly DEFAULT_KEY_LENGTH_BYTES = 32;
  private static readonly LEGACY_SEPARATOR = ":";

  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  private usersById = new Map<string, AuthUserRecord>();
  private userIdByUsername = new Map<string, string>();

  constructor(
    repository: AuthRepository,
    options: AuthenticationIdentityServiceOptions,
  ) {
    this.repository = repository;
    this.passwordPepper = options.passwordPepper;
    this.pbkdf2Iterations =
      options.pbkdf2Iterations ??
      AuthenticationIdentityService.DEFAULT_PBKDF2_ITERATIONS;
    this.pbkdf2KeyLengthBytes =
      options.pbkdf2KeyLengthBytes ??
      AuthenticationIdentityService.DEFAULT_KEY_LENGTH_BYTES;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initializePromise) {
      this.initializePromise = this.loadCache();
    }

    await this.initializePromise;
    this.initialized = true;
  }

  async listUsers(): Promise<AuthUser[]> {
    await this.initialize();

    return Array.from(this.usersById.values()).map((record) =>
      this.toAuthUser(record),
    );
  }

  async createUser(
    username: string,
    password: string,
    role: string,
    options: { isActive?: boolean } = {},
  ): Promise<AuthUser> {
    await this.initialize();

    const normalizedUsername = this.normalizeUsername(username);
    if (this.userIdByUsername.has(normalizedUsername)) {
      throw new Error(`Auth: username already exists (${username})`);
    }

    const passwordHash = await this.hashPassword(password);

    const params: CreateAuthUserParams = {
      userId: crypto.randomUUID(),
      username,
      passwordHash,
      role,
      bearerToken: crypto.randomUUID(),
      isActive: options.isActive ?? true,
    };

    const record = await this.repository.insertUser(params);
    this.addRecordToCache(record);

    return this.toAuthUser(record);
  }

  async authenticateWithPassword(
    username: string,
    password: string,
  ): Promise<AuthenticationResult | null> {
    await this.initialize();

    const record = this.findByUsername(username);
    if (!record || !record.isActive || !record.passwordHash) {
      return null;
    }

    const matches = await this.verifyPassword(record.passwordHash, password);

    if (!matches) {
      return null;
    }

    return {
      user: this.toAuthUser(record),
      token: record.bearerToken!,
    };
  }

  async validateToken(token: string): Promise<AuthUser | null> {
    // Database lookup makes newly provisioned identities visible on every instance.
    // Do not fall back to a stale cache when a persistent lookup rejects a token.
    const record = await this.repository.findUserByToken(token);
    return record?.isActive ? this.toAuthUser(record) : null;
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    await this.initialize();

    const record = this.usersById.get(userId);
    if (!record || !record.isActive) {
      return null;
    }

    return this.toAuthUser(record);
  }

  private normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  private findByUsername(username: string): AuthUserRecord | null {
    const normalized = this.normalizeUsername(username);
    const userId = this.userIdByUsername.get(normalized);
    if (!userId) {
      return null;
    }

    return this.usersById.get(userId) ?? null;
  }

  private async loadCache(): Promise<void> {
    const users = await this.repository.getAllUsers();

    this.usersById.clear();
    this.userIdByUsername.clear();

    users.forEach((record) => this.addRecordToCache(record));
  }

  private addRecordToCache(record: AuthUserRecord): void {
    const normalized = this.normalizeUsername(record.username);

    this.usersById.set(record.userId, record);
    this.userIdByUsername.set(normalized, record.userId);
  }

  private toAuthUser(record: AuthUserRecord): AuthUser {
    return {
      userId: record.userId,
      username: record.username,
      role: record.role,
    };
  }

  private async hashPassword(password: string): Promise<string> {
    const saltBytes = crypto.getRandomValues(new Uint8Array(32));
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      this.textEncoder.encode(password + this.passwordPepper),
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: saltBytes.buffer as ArrayBuffer,
        iterations: this.pbkdf2Iterations,
      },
      keyMaterial,
      this.pbkdf2KeyLengthBytes * 8,
    );

    const hashBytes = new Uint8Array(derivedBits);
    const saltHex = this.bytesToHex(saltBytes);
    const hashHex = this.bytesToHex(hashBytes);

    return `${AuthenticationIdentityService.HASH_SCHEME}:${saltHex}:${this.pbkdf2Iterations}:${hashHex}`;
  }

  private async verifyPassword(
    stored: string,
    password: string,
  ): Promise<boolean> {
    const parts = stored.split(AuthenticationIdentityService.LEGACY_SEPARATOR);

    if (
      parts.length === 4 &&
      parts[0] === AuthenticationIdentityService.HASH_SCHEME
    ) {
      const [, saltHex, iterationsRaw, hashHex] = parts;
      const iterations = Number(iterationsRaw);
      if (!Number.isFinite(iterations) || iterations <= 0) {
        return false;
      }

      const saltBytes = this.hexToBytes(saltHex);
      const expectedHash = this.hexToBytes(hashHex);
      if (saltBytes.length === 0 || expectedHash.length === 0) {
        return false;
      }

      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        this.textEncoder.encode(password + this.passwordPepper),
        { name: "PBKDF2" },
        false,
        ["deriveBits"],
      );

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: saltBytes.buffer as ArrayBuffer,
          iterations,
        },
        keyMaterial,
        expectedHash.length * 8,
      );

      const computedHash = new Uint8Array(derivedBits);
      return this.constantTimeEquals(expectedHash, computedHash);
    }

    if (parts.length === 3) {
      const [saltHex, iterationsRaw, hashHex] = parts;
      const iterations = Number(iterationsRaw);
      if (!Number.isFinite(iterations) || iterations <= 0) {
        return false;
      }

      const saltBytes = this.hexToBytes(saltHex);
      const expectedHash = this.hexToBytes(hashHex);
      if (saltBytes.length === 0 || expectedHash.length === 0) {
        return false;
      }

      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        this.textEncoder.encode(password + this.passwordPepper),
        { name: "PBKDF2" },
        false,
        ["deriveBits"],
      );

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: saltBytes.buffer as ArrayBuffer,
          iterations,
        },
        keyMaterial,
        expectedHash.length * 8,
      );

      const computedHash = new Uint8Array(derivedBits);
      return this.constantTimeEquals(expectedHash, computedHash);
    }

    if (parts.length === 2) {
      return await this.verifyLegacyPassword(stored, password);
    }

    return false;
  }

  private hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0 || hex.length === 0) {
      return new Uint8Array();
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private async verifyLegacyPassword(
    stored: string,
    password: string,
  ): Promise<boolean> {
    const [saltHex, hashHex] = stored.split(
      AuthenticationIdentityService.LEGACY_SEPARATOR,
    );
    if (!saltHex || !hashHex) {
      return false;
    }

    const data = this.textEncoder.encode(
      `${saltHex}:${password}${this.passwordPepper}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", data);
    const computedHash = new Uint8Array(digest);
    const expectedHash = this.hexToBytes(hashHex);

    if (expectedHash.length !== computedHash.length) {
      return false;
    }

    return this.constantTimeEquals(expectedHash, computedHash);
  }

  private constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }

    return diff === 0;
  }
}

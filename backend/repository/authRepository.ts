export interface AuthUserRecord {
  userId: string;
  username: string;
  passwordHash: string | null;
  bearerToken: string | null;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAuthUserParams {
  userId: string;
  username: string;
  passwordHash: string;
  role: string;
  bearerToken: string;
  isActive: boolean;
}

export interface AuthRepository {
  close(): Promise<void>;
  getAllUsers(): Promise<AuthUserRecord[]>;
  findUserByToken(token: string): Promise<AuthUserRecord | null>;
  insertUser(params: CreateAuthUserParams): Promise<AuthUserRecord>;
}

export interface AuthUser {
  userId: string;
  username: string;
  role: string;
}

export interface AuthToken {
  token: string;
  user: AuthUser;
  createdAt: Date;
  expiresAt: Date | null;
}

export type UserRole = 'admin' | 'viewer';

export type ApiScope =
  | 'status:read'
  | 'filters:read'
  | 'filters:write'
  | 'wishlist:read'
  | 'wishlist:write'
  | 'history:read'
  | 'events:read'
  | 'irc:control'
  | 'snatch:write';

export const ALL_SCOPES: ApiScope[] = [
  'status:read',
  'filters:read',
  'filters:write',
  'wishlist:read',
  'wishlist:write',
  'history:read',
  'events:read',
  'irc:control',
  'snatch:write',
];

export interface User {
  id: string;
  username: string;
  role: UserRole;
  enabled: boolean;
  mustChangePassword: boolean;
  discordId: string | null;
  oidcSub?: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AuthIdentity {
  user: User;
  authType: 'session' | 'api_key';
  scopes: ApiScope[] | null; // null = full role-based access (session)
  apiKeyId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthIdentity;
  }
}

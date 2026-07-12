export interface Env extends Cloudflare.Env {
  ADMIN_TOKEN?: string;
  ADMIN_TOKEN_HASH?: string;
  CORS_ALLOWED_ORIGINS?: string;
  AMEGO_API_BASE_URL?: string;
}

export type RequestContext = {
  requestId: string;
  startedAt: number;
  method: string;
  route: string;
  companyId?: number;
  userId?: number;
  deviceId?: string;
  actorType?: "user" | "device" | "admin" | "anonymous";
};

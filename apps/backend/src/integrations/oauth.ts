export interface OAuthTokens {
  accessToken: string;
  /** Present on the first exchange; Zoom also rotates it on every refresh. */
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

export interface OAuthProviderClient {
  /** True when the platform's OAuth app credentials are set. */
  configured(): boolean;
  authorizeUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  account(accessToken: string): Promise<{ email: string; name?: string }>;
  revoke(token: string): Promise<void>;
}

export function toTokens(r: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }): OAuthTokens {
  return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresIn: r.expires_in ?? 3600, scope: r.scope };
}

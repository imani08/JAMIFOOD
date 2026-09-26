import type { IncomingHttpHeaders } from 'node:http';
/** Minimal HTTP adapter contract used by the controllers. */
export interface Request {
  headers: IncomingHttpHeaders;
  method: string;
}
export interface CookieOptions { httpOnly?: boolean; secure?: boolean; sameSite?: 'strict' | 'lax' | 'none'; path?: string; maxAge?: number }
export interface Response {
  status(code: number): Response;
  json(body: unknown): void;
  send(body: string): void;
  setHeader(name: string, value: string): void;
  cookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options: CookieOptions): void;
}

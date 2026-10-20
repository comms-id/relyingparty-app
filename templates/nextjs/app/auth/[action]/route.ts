// /auth/sign-in, /auth/callback, /auth/renew (GET) and /auth/sign-out (POST): the shared core answers.
import { handle } from "../../../src/auth";

export const dynamic = "force-dynamic";
export const GET = handle;
export const POST = handle;

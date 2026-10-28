import { jwtVerify } from "jose";
import type { RequestHandler } from "express";

import {
  getAccessTokenSecret,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from "../config/auth-config.ts";
import { sessionExists } from "../services/session/session-service.ts";

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; sid: string };
  }
}

export async function verifyAccessToken(
  req: Parameters<RequestHandler>[0],
): Promise<{ id: string; sid: string } | null> {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) return null;

  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], getAccessTokenSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }));
  } catch {
    return null;
  }

  if (
    !payload.sub ||
    typeof payload.sid !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sid)
  ) {
    return null;
  }

  return { id: payload.sub, sid: payload.sid };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const user = await verifyAccessToken(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!(await sessionExists(user.sid))) return res.status(401).json({ error: "Unauthorized" });

  req.user = user;
  return next();
};

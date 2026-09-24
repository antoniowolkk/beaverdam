import { randomBytes } from "node:crypto";
import argon2 from "argon2";

// argon2 defaults are argon2id, 64 MiB, t=3, p=4 — above the OWASP minimum. Do not lower them.
export const hashPassword = (plain: string) => argon2.hash(plain, { type: argon2.argon2id });
export const verifyPassword = (hash: string, plain: string) => argon2.verify(hash, plain);

// Verified against when the email does not exist, so both paths take the same time.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

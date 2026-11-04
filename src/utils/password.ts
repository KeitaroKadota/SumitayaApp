import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

// みるきーの password.ts をそのまま流用(CMN-01 01 7.1)。
// scripts/create-president.mjs にも同じ作り方を書いているので、変えるときは両方を直す。
const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

// パスワードを saltHex:hashHex の形でハッシュ化する
export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;

  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const hashBuffer = Buffer.from(hashHex, "hex");
  if (derived.length !== hashBuffer.length) return false;

  return timingSafeEqual(derived, hashBuffer);
};

// 初期パスワード用。紛らわしい文字(0/O, 1/l/I)は除く(EV-08)
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export const generatePassword = (length = 10): string => {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
};

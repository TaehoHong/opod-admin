import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { PrismaService } from "../../domain/database/prisma.service";

const defaultAdminEmail = "admin@opod.com";
const defaultAdminPassword = "qwer1234";
const adminJwtTtlSeconds = 7 * 24 * 60 * 60;

export type AuthenticatedAdmin = {
  id: string;
  email: string;
};

type AdminRow = AuthenticatedAdmin & {
  password: string;
  isEnabled: boolean;
  isDeleted: boolean;
  createdAt: Date;
};

type PublicAdminRow = AuthenticatedAdmin & {
  isEnabled: boolean;
  isDeleted: boolean;
  createdAt: Date;
};

type JwtPayload = {
  sub: string;
  aud: "admin";
  iat: number;
  exp: number;
};

const adminAuthFields = {
  id: true,
  email: true,
  password: true,
  isEnabled: true,
  isDeleted: true,
  createdAt: true,
} as const;

const publicAdminFields = {
  id: true,
  email: true,
  isEnabled: true,
  isDeleted: true,
  createdAt: true,
} as const;

@Injectable()
export class AdminAuthService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const existing = await this.prisma.admin.findUnique({
      where: { email: defaultAdminEmail },
      select: adminAuthFields,
    });
    if (existing) return;

    await this.createAdmin({
      email: defaultAdminEmail,
      password: hashAdminPassword(defaultAdminPassword),
    });
  }

  async login(input: { email: string; password: string }) {
    const email = normalizeEmail(input.email);
    const password = requiredString(input.password, "password");
    const admin = (await this.prisma.admin.findUnique({
      where: { email },
      select: adminAuthFields,
    })) as AdminRow | null;

    if (
      !admin ||
      !admin.isEnabled ||
      admin.isDeleted ||
      !verifyAdminPassword(password, admin.password)
    ) {
      throw new UnauthorizedException("Invalid admin credentials");
    }

    const token = this.issueAdminToken(admin.id);
    const payload = this.verifyAdminToken(token);
    return {
      token,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      admin: this.toPublicAdmin(admin),
    };
  }

  async authenticateAdminToken(token: string): Promise<AuthenticatedAdmin> {
    const payload = this.verifyAdminToken(token);
    const admin = await this.findEnabledAdminById(payload.sub);
    if (!admin) {
      throw new UnauthorizedException("Admin login is required");
    }
    return { id: admin.id, email: admin.email };
  }

  async createAdminAccount(
    input: { email: string; password: string },
    creatorAdminId: string,
  ) {
    const creatorId = requiredString(creatorAdminId, "creatorAdminId");
    const creator = await this.findEnabledAdminById(creatorId);
    if (!creator) {
      throw new BadRequestException("Creator admin is required");
    }

    const email = normalizeEmail(input.email);
    const password = requiredString(input.password, "password");
    assertPassword(password);

    const admin = await this.createAdmin({
      email,
      password: hashAdminPassword(password),
    });

    return {
      id: admin.id,
      email: admin.email,
      isEnabled: admin.isEnabled,
      isDeleted: admin.isDeleted,
      createdAt: admin.createdAt.toISOString(),
    };
  }

  async logout() {
    return { status: "ok" };
  }

  private issueAdminToken(adminId: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: adminId,
      aud: "admin",
      iat: now,
      exp: now + adminJwtTtlSeconds,
    };
    return this.signJwt(payload);
  }

  private verifyAdminToken(token: string): JwtPayload {
    const value = token?.trim() ?? "";
    const parts = value.split(".");
    if (parts.length !== 3) {
      throw new UnauthorizedException("Admin login is required");
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = createHmac("sha256", this.jwtSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");
    if (!timingSafeStringEqual(signature, expectedSignature)) {
      throw new UnauthorizedException("Admin login is required");
    }

    try {
      const header = JSON.parse(
        Buffer.from(encodedHeader, "base64url").toString("utf8"),
      ) as { alg?: string };
      const payload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      ) as Partial<JwtPayload>;

      if (
        header.alg !== "HS256" ||
        payload.aud !== "admin" ||
        typeof payload.sub !== "string" ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        payload.exp <= Math.floor(Date.now() / 1000)
      ) {
        throw new UnauthorizedException("Admin login is required");
      }

      return payload as JwtPayload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("Admin login is required");
    }
  }

  private signJwt(payload: JwtPayload): string {
    const encodedHeader = encodeJson({ alg: "HS256", typ: "JWT" });
    const encodedPayload = encodeJson(payload);
    const signature = createHmac("sha256", this.jwtSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private async findEnabledAdminById(id: string) {
    const admin = (await this.prisma.admin.findUnique({
      where: { id },
      select: publicAdminFields,
    })) as PublicAdminRow | null;
    if (!admin || !admin.isEnabled || admin.isDeleted) return null;
    return admin;
  }

  private async createAdmin(input: { email: string; password: string }) {
    try {
      return await this.prisma.admin.create({
        data: {
          email: input.email,
          password: input.password,
          isEnabled: true,
          isDeleted: false,
        },
        select: publicAdminFields,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictException("Admin email already exists");
      }
      throw error;
    }
  }

  private jwtSecret(): string {
    const secret =
      process.env.ADMIN_JWT_SECRET?.trim() ||
      process.env.AUTH_JWT_SECRET?.trim() ||
      process.env.ADMIN_API_KEY?.trim();
    if (!secret) {
      throw new Error("ADMIN_JWT_SECRET or AUTH_JWT_SECRET is required");
    }
    return secret;
  }

  private toPublicAdmin(admin: PublicAdminRow) {
    return {
      id: admin.id,
      email: admin.email,
      isEnabled: admin.isEnabled,
      isDeleted: admin.isDeleted,
      createdAt: admin.createdAt.toISOString(),
    };
  }
}

export function hashAdminPassword(password: string, salt = randomSalt()) {
  const key = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${key}`;
}

function verifyAdminPassword(
  password: string,
  storedPassword: string,
): boolean {
  const [algorithm, salt, expected] = storedPassword.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("base64url");
  return timingSafeStringEqual(actual, expected);
}

function normalizeEmail(email: unknown): string {
  const value = requiredString(email, "email").toLowerCase();
  if (!value.includes("@")) {
    throw new BadRequestException("Email is invalid");
  }
  return value;
}

function assertPassword(password: string) {
  if (password.length < 8) {
    throw new BadRequestException("Password must be at least 8 characters");
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  return value.trim();
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function randomSalt() {
  return randomBytes(16).toString("base64url");
}

function timingSafeStringEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

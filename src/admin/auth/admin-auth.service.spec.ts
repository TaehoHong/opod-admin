import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { AppConfigService } from "../../domain/config/app-config.service";
import { AdminAuthService, hashAdminPassword } from "./admin-auth.service";
import { DuplicateAdminEmailError } from "./admin.repository";

type TestAdminRow = {
  id: string;
  email: string;
  password: string;
  isEnabled: boolean;
  isDeleted: boolean;
  createdAt: Date;
};

function createService(
  initialRows: TestAdminRow[] = [],
  env: Record<string, string | undefined> = {},
) {
  const rows = [...initialRows];
  // application service는 concrete repository를 주입받으므로
  // (docs/02-development-rules.md:55) 테스트도 Prisma 대신 repository를 대체한다.
  const admins = {
    countAll: jest.fn(() => Promise.resolve(rows.length)),
    findByEmailWithPassword: jest.fn((email: string) =>
      Promise.resolve(rows.find((row) => row.email === email) ?? null),
    ),
    findById: jest.fn((id: string) =>
      Promise.resolve(rows.find((row) => row.id === id) ?? null),
    ),
    create: jest.fn((input: { email: string; password: string }) => {
      if (rows.some((row) => row.email === input.email)) {
        return Promise.reject(new DuplicateAdminEmailError(input.email));
      }
      const row = {
        id: `admin-${rows.length + 1}`,
        email: input.email,
        password: input.password,
        isEnabled: true,
        isDeleted: false,
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
      };
      rows.push(row);
      return Promise.resolve(row);
    }),
  };

  return {
    rows,
    admins,
    service: new AdminAuthService(
      admins as never,
      // typed config를 주입하므로 테스트가 process.env를 건드리지 않는다.
      new AppConfigService({
        DATABASE_URL: "postgresql://test/test",
        ADMIN_JWT_SECRET: "test-admin-secret",
        ...env,
      }),
    ),
  };
}

function defaultAdmin(overrides: Partial<TestAdminRow> = {}): TestAdminRow {
  return {
    id: "admin-1",
    email: "admin@example.test",
    password: hashAdminPassword("test-password-1", "salt"),
    isEnabled: true,
    isDeleted: false,
    createdAt: new Date("2026-07-07T00:00:00.000Z"),
    ...overrides,
  };
}

const bootstrapEnv = {
  ADMIN_BOOTSTRAP_EMAIL: " Bootstrap@Example.test ",
  ADMIN_BOOTSTRAP_PASSWORD: "bootstrap-password",
};

describe("AdminAuthService", () => {
  // docs/03-deployment-rules.md "First Admin" — 알려진 기본 계정이 자동으로
  // 생기면 운영 콘솔에 누구나 로그인할 수 있다.
  it("creates the first admin from bootstrap env vars when no admin exists", async () => {
    const { admins, rows, service } = createService([], bootstrapEnv);

    await service.onModuleInit();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "bootstrap@example.test",
      isEnabled: true,
      isDeleted: false,
    });
    expect(rows[0].password).toMatch(/^scrypt\$/);
    expect(rows[0].password).not.toContain("bootstrap-password");
    expect(admins.create).toHaveBeenCalledTimes(1);
  });

  it("fails startup when no admin exists and bootstrap env vars are missing", async () => {
    const { admins, service } = createService();

    await expect(service.onModuleInit()).rejects.toThrow(
      /ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD are required/,
    );
    expect(admins.create).not.toHaveBeenCalled();
  });

  it("does not create or change an account when an admin already exists", async () => {
    const existing = defaultAdmin();
    const { admins, rows, service } = createService([existing], bootstrapEnv);

    await service.onModuleInit();

    expect(rows).toEqual([existing]);
    expect(admins.create).not.toHaveBeenCalled();
  });

  it("logs in an enabled admin and returns a JWT", async () => {
    const { service } = createService([defaultAdmin()]);

    const result = await service.login({
      email: " admin@example.test ",
      password: "test-password-1",
    });

    expect(result.admin).toEqual({
      id: "admin-1",
      email: "admin@example.test",
      isEnabled: true,
      isDeleted: false,
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    expect(result.token.split(".")).toHaveLength(3);
    expect(result.expiresAt).toEqual(expect.any(String));
    await expect(service.authenticateAdminToken(result.token)).resolves.toEqual(
      {
        id: "admin-1",
        email: "admin@example.test",
      },
    );
  });

  it("rejects invalid, disabled, or deleted admin credentials", async () => {
    await expect(
      createService([defaultAdmin()]).service.login({
        email: "admin@example.test",
        password: "wrong",
      }),
    ).rejects.toThrow(UnauthorizedException);

    await expect(
      createService([defaultAdmin({ isEnabled: false })]).service.login({
        email: "admin@example.test",
        password: "test-password-1",
      }),
    ).rejects.toThrow(UnauthorizedException);

    await expect(
      createService([defaultAdmin({ isDeleted: true })]).service.login({
        email: "admin@example.test",
        password: "test-password-1",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("creates admin accounts with an enabled creator admin", async () => {
    const { rows, service } = createService([defaultAdmin()]);

    const created = await service.createAdminAccount(
      { email: " next@opod.com ", password: " next-pass " },
      "admin-1",
    );

    expect(created).toEqual({
      id: "admin-2",
      email: "next@opod.com",
      isEnabled: true,
      isDeleted: false,
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    expect(rows[1].password).toMatch(/^scrypt\$/);
    expect(rows[1].password).not.toContain("next-pass");
  });

  it("requires an enabled creator admin when creating admin accounts", async () => {
    const { service } = createService([defaultAdmin()]);

    await expect(
      service.createAdminAccount(
        { email: "next@opod.com", password: "next-pass" },
        "",
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createAdminAccount(
        { email: "next@opod.com", password: "next-pass" },
        "missing-admin",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects duplicate admin account emails", async () => {
    const { service } = createService([defaultAdmin()]);

    await expect(
      service.createAdminAccount(
        { email: "admin@example.test", password: "next-pass" },
        "admin-1",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("hashes admin passwords without storing the raw password", () => {
    const passwordHash = hashAdminPassword("test-password-1", "salt");

    expect(passwordHash).toMatch(/^scrypt\$/);
    expect(passwordHash).not.toContain("test-password-1");
  });
});

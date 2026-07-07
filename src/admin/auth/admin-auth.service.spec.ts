import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { AdminAuthService, hashAdminPassword } from "./admin-auth.service";

type TestAdminRow = {
  id: string;
  email: string;
  password: string;
  isEnabled: boolean;
  isDeleted: boolean;
  createdAt: Date;
};

function createService(initialRows: TestAdminRow[] = []) {
  const rows = [...initialRows];
  const prisma = {
    admin: {
      findUnique: jest.fn(({ where }: { where: { id?: string; email?: string } }) =>
        Promise.resolve(
          rows.find(
            (row) =>
              (where.id && row.id === where.id) ||
              (where.email && row.email === where.email),
          ) ?? null,
        ),
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: {
            email: string;
            password: string;
            isEnabled?: boolean;
            isDeleted?: boolean;
          };
        }) => {
          if (rows.some((row) => row.email === data.email)) {
            throw Object.assign(new Error("duplicate admin"), {
              code: "P2002",
            });
          }

          const row = {
            id: `admin-${rows.length + 1}`,
            email: data.email,
            password: data.password,
            isEnabled: data.isEnabled ?? true,
            isDeleted: data.isDeleted ?? false,
            createdAt: new Date("2026-07-07T00:00:00.000Z"),
          };
          rows.push(row);
          return Promise.resolve(row);
        },
      ),
    },
  };

  return {
    rows,
    prisma,
    service: new AdminAuthService(prisma as never),
  };
}

function defaultAdmin(overrides: Partial<TestAdminRow> = {}): TestAdminRow {
  return {
    id: "admin-1",
    email: "admin@opod.com",
    password: hashAdminPassword("qwer1234", "salt"),
    isEnabled: true,
    isDeleted: false,
    createdAt: new Date("2026-07-07T00:00:00.000Z"),
    ...overrides,
  };
}

describe("AdminAuthService", () => {
  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = "test-admin-secret";
  });

  afterEach(() => {
    delete process.env.ADMIN_JWT_SECRET;
  });

  it("creates the default admin account when it does not exist", async () => {
    const { prisma, rows, service } = createService();

    await service.onModuleInit();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "admin@opod.com",
      isEnabled: true,
      isDeleted: false,
    });
    expect(rows[0].password).toMatch(/^scrypt\$/);
    expect(rows[0].password).not.toContain("qwer1234");
    expect(prisma.admin.create).toHaveBeenCalledTimes(1);
  });

  it("logs in an enabled admin and returns a JWT", async () => {
    const { service } = createService([defaultAdmin()]);

    const result = await service.login({
      email: " admin@opod.com ",
      password: "qwer1234",
    });

    expect(result.admin).toEqual({
      id: "admin-1",
      email: "admin@opod.com",
      isEnabled: true,
      isDeleted: false,
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    expect(result.token.split(".")).toHaveLength(3);
    expect(result.expiresAt).toEqual(expect.any(String));
    await expect(service.authenticateAdminToken(result.token)).resolves.toEqual(
      {
        id: "admin-1",
        email: "admin@opod.com",
      },
    );
  });

  it("rejects invalid, disabled, or deleted admin credentials", async () => {
    await expect(
      createService([defaultAdmin()]).service.login({
        email: "admin@opod.com",
        password: "wrong",
      }),
    ).rejects.toThrow(UnauthorizedException);

    await expect(
      createService([defaultAdmin({ isEnabled: false })]).service.login({
        email: "admin@opod.com",
        password: "qwer1234",
      }),
    ).rejects.toThrow(UnauthorizedException);

    await expect(
      createService([defaultAdmin({ isDeleted: true })]).service.login({
        email: "admin@opod.com",
        password: "qwer1234",
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
        { email: "admin@opod.com", password: "next-pass" },
        "admin-1",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("hashes admin passwords without storing the raw password", () => {
    const passwordHash = hashAdminPassword("qwer1234", "salt");

    expect(passwordHash).toMatch(/^scrypt\$/);
    expect(passwordHash).not.toContain("qwer1234");
  });
});

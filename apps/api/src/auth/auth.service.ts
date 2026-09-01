import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Onboarding entry point: creates the team + owner user in one step, so a
  // non-technical user goes straight into the guided wizard afterwards
  // (target: time-to-first-campaign < 20 minutes).
  async registerTeam(input: { teamName: string; email: string; password: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException("Email already registered");

    const passwordHash = await bcrypt.hash(input.password, 10);

    const team = await this.prisma.team.create({
      data: {
        name: input.teamName,
        users: {
          create: {
            email: input.email,
            passwordHash,
            role: "OWNER",
          },
        },
        // Single, transparent plan for every new team — no tiers to pick.
        subscription: {
          create: {
            tier: "STANDARD",
            monthlyFeeEur: 49,
            conversationsIncluded: 1000,
            usageAlertThresholdPct: 80,
          },
        },
      },
      include: { users: true },
    });

    const owner = team.users[0];
    return this.issueToken(owner.id, team.id, "OWNER");
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException("Invalid credentials");
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Invalid credentials");
    return this.issueToken(user.id, user.teamId, user.role);
  }

  private issueToken(userId: string, teamId: string, role: "OWNER" | "OPERATOR") {
    const accessToken = this.jwt.sign({ sub: userId, teamId, role });
    return { accessToken };
  }
}

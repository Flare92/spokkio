import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

// Every tool input carries an explicit teamId (so the same schema works for
// an external MCP caller with no session cookie). For UI/session callers we
// must still enforce that the authenticated user's own team is the one
// being acted on — this guard is what prevents one team from reading or
// writing another team's data by simply passing a different teamId.
@Injectable()
export class TeamScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const bodyTeamId = request.body?.teamId;
    const userTeamId = request.user?.teamId;

    if (bodyTeamId && userTeamId && bodyTeamId !== userTeamId) {
      throw new ForbiddenException("teamId does not match the authenticated user's team");
    }
    return true;
  }
}

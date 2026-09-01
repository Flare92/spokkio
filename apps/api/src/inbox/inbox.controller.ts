import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ListConversationsInput, SendMessageInput } from "@spokkio/shared";
import { InboxService } from "./inbox.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TeamScopeGuard } from "../auth/team-scope.guard";

@UseGuards(JwtAuthGuard, TeamScopeGuard)
@Controller("inbox")
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  // tool: inbox.listConversations
  @Post("conversations/list")
  list(@Body(new ZodValidationPipe(ListConversationsInput)) body: ListConversationsInput) {
    return this.inbox.listConversations(body);
  }

  // tool: inbox.sendMessage
  @Post("messages/send")
  send(@Body(new ZodValidationPipe(SendMessageInput)) body: SendMessageInput) {
    return this.inbox.sendMessage(body);
  }
}

import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  ListConversationsInput,
  GetConversationInput,
  SendMessageInput,
  AssignConversationInput,
  SetConversationLabelsInput,
  ListOperatorsInput,
  ListCannedResponsesInput,
  CreateCannedResponseInput,
  DeleteCannedResponseInput,
} from "@spokkio/shared";
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

  // tool: inbox.getConversation
  @Post("conversations/get")
  get(@Body(new ZodValidationPipe(GetConversationInput)) body: GetConversationInput) {
    return this.inbox.getConversation(body);
  }

  // tool: inbox.assign
  @Post("conversations/assign")
  assign(@Body(new ZodValidationPipe(AssignConversationInput)) body: AssignConversationInput) {
    return this.inbox.assignConversation(body);
  }

  // tool: inbox.setLabels
  @Post("conversations/labels")
  setLabels(@Body(new ZodValidationPipe(SetConversationLabelsInput)) body: SetConversationLabelsInput) {
    return this.inbox.setLabels(body);
  }

  // tool: inbox.listOperators
  @Post("operators/list")
  listOperators(@Body(new ZodValidationPipe(ListOperatorsInput)) body: ListOperatorsInput) {
    return this.inbox.listOperators(body);
  }

  // tool: inbox.sendMessage
  @Post("messages/send")
  send(@Body(new ZodValidationPipe(SendMessageInput)) body: SendMessageInput) {
    return this.inbox.sendMessage(body);
  }

  // tool: inbox.listCannedResponses
  @Post("canned-responses/list")
  listCanned(@Body(new ZodValidationPipe(ListCannedResponsesInput)) body: ListCannedResponsesInput) {
    return this.inbox.listCannedResponses(body);
  }

  // tool: inbox.createCannedResponse
  @Post("canned-responses/create")
  createCanned(@Body(new ZodValidationPipe(CreateCannedResponseInput)) body: CreateCannedResponseInput) {
    return this.inbox.createCannedResponse(body);
  }

  // tool: inbox.deleteCannedResponse
  @Post("canned-responses/delete")
  deleteCanned(@Body(new ZodValidationPipe(DeleteCannedResponseInput)) body: DeleteCannedResponseInput) {
    return this.inbox.deleteCannedResponse(body);
  }
}

import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  ImportContactsInput,
  TagContactsInput,
  CreateSegmentInput,
  ListSegmentsInput,
  ListContactsInput,
} from "@spokkio/shared";
import { ContactsService } from "./contacts.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TeamScopeGuard } from "../auth/team-scope.guard";

// Every endpoint here is a thin binding to one tool from @spokkio/shared's
// TOOL_REGISTRY (tool name in the comment above each route).
@UseGuards(JwtAuthGuard, TeamScopeGuard)
@Controller("contacts")
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  // tool: contacts.import
  @Post("import")
  import(@Body(new ZodValidationPipe(ImportContactsInput)) body: ImportContactsInput) {
    return this.contacts.importContacts(body);
  }

  // tool: contacts.tag
  @Post("tag")
  tag(@Body(new ZodValidationPipe(TagContactsInput)) body: TagContactsInput) {
    return this.contacts.tagContacts(body);
  }

  // tool: contacts.list
  @Post("list")
  list(@Body(new ZodValidationPipe(ListContactsInput)) body: ListContactsInput) {
    return this.contacts.listContacts(body);
  }

  // tool: contacts.createSegment
  @Post("segments")
  createSegment(@Body(new ZodValidationPipe(CreateSegmentInput)) body: CreateSegmentInput) {
    return this.contacts.createSegment(body);
  }

  // tool: contacts.listSegments
  @Post("segments/list")
  listSegments(@Body(new ZodValidationPipe(ListSegmentsInput)) body: ListSegmentsInput) {
    return this.contacts.listSegments(body);
  }
}

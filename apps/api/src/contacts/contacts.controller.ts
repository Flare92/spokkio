import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  ImportContactsInput,
  TagContactsInput,
  AssignCategoriesInput,
  CreateSegmentInput,
  ListSegmentsInput,
  ListContactsInput,
  EnsureCategorySegmentInput,
  GetContactInput,
  UpdateContactInput,
  FindDuplicateContactsInput,
  MergeContactsInput,
  ExportContactsInput,
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

  // tool: contacts.assignCategories
  @Post("categories/assign")
  assignCategories(@Body(new ZodValidationPipe(AssignCategoriesInput)) body: AssignCategoriesInput) {
    return this.contacts.assignCategories(body);
  }

  // tool: contacts.ensureCategorySegment
  @Post("categories/segment")
  ensureCategorySegment(
    @Body(new ZodValidationPipe(EnsureCategorySegmentInput)) body: EnsureCategorySegmentInput,
  ) {
    return this.contacts.ensureCategorySegment(body);
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

  // tool: contacts.get
  @Post("get")
  get(@Body(new ZodValidationPipe(GetContactInput)) body: GetContactInput) {
    return this.contacts.getContactDetail(body);
  }

  // tool: contacts.update
  @Post("update")
  update(@Body(new ZodValidationPipe(UpdateContactInput)) body: UpdateContactInput) {
    return this.contacts.updateContact(body);
  }

  // tool: contacts.findDuplicates
  @Post("duplicates")
  findDuplicates(@Body(new ZodValidationPipe(FindDuplicateContactsInput)) body: FindDuplicateContactsInput) {
    return this.contacts.findDuplicates(body);
  }

  // tool: contacts.merge
  @Post("merge")
  merge(@Body(new ZodValidationPipe(MergeContactsInput)) body: MergeContactsInput) {
    return this.contacts.mergeContacts(body);
  }

  // tool: contacts.export
  @Post("export")
  export(@Body(new ZodValidationPipe(ExportContactsInput)) body: ExportContactsInput) {
    return this.contacts.exportContacts(body);
  }
}

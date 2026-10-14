import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { UploadMediaInput, GetMediaInput } from "@spokkio/shared";
import { MediaService } from "./media.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TeamScopeGuard } from "../auth/team-scope.guard";

@UseGuards(JwtAuthGuard, TeamScopeGuard)
@Controller("media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

  // tool: media.upload
  @Post("upload")
  upload(@Body(new ZodValidationPipe(UploadMediaInput)) body: UploadMediaInput) {
    return this.media.upload(body);
  }

  // tool: media.get
  @Post("get")
  get(@Body(new ZodValidationPipe(GetMediaInput)) body: GetMediaInput) {
    return this.media.get(body);
  }
}

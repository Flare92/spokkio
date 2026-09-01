import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

// Binds one HTTP endpoint to one tool's input schema from @spokkio/shared.
// This is what keeps "every business action is a tool" true in practice:
// a controller method can only accept exactly the shape a tool declares,
// the same shape an MCP layer will validate against later.
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}

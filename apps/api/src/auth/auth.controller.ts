import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "./auth.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";

const RegisterInput = z.object({
  teamName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body(new ZodValidationPipe(RegisterInput)) body: z.infer<typeof RegisterInput>) {
    return this.auth.registerTeam(body);
  }

  @Post("login")
  login(@Body(new ZodValidationPipe(LoginInput)) body: z.infer<typeof LoginInput>) {
    return this.auth.login(body.email, body.password);
  }
}

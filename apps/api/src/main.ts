import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  // Le immagini arrivano in base64 dentro il JSON: il limite di default
  // (100 KB) bloccherebbe qualunque foto reale.
  app.useBodyParser("json", { limit: "10mb" });
  app.setGlobalPrefix("api/v1");
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Spokkio API listening on :${port}`);
}
bootstrap();

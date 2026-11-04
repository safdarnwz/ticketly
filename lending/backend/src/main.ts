import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_CONFIG, AppConfig } from './config/configuration';

async function main() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const cfg = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, cfg.corsOrigin);
  await app.listen(cfg.port);
  console.log(`Lending API on http://localhost:${cfg.port}/api (integrations: ${cfg.integrationsMode})`);
}
main();

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { DatabaseModule } from './database/database.module';
import { SchemaModule } from './schema/schema.module';
import { SqlChatModule } from './sql-chat/sql-chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    // Serves src/public (copied to dist/public at build time — see
    // nest-cli.json) at the app's own root, so the whole thing — API and
    // UI — lives at one URL/deployment. /chat/* stays routed to
    // SqlChatController; everything else falls through to index.html.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, 'public'),
      exclude: ['/chat/(.*)'],
    }),
    DatabaseModule,
    SchemaModule,
    SqlChatModule,
  ],
})
export class AppModule {}

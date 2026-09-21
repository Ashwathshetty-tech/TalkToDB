import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { SchemaModule } from './schema/schema.module';
import { SqlChatModule } from './sql-chat/sql-chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    SchemaModule,
    SqlChatModule,
  ],
})
export class AppModule {}

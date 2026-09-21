import { Module } from '@nestjs/common';
import { SchemaModule } from '../schema/schema.module';
import { SqlChatController } from './sql-chat.controller';
import { SqlChatService } from './sql-chat.service';
import { SqlGeneratorService } from './sql-generator.service';
import { SqlValidatorService } from './sql-validator.service';
import { SqlExecutorService } from './sql-executor.service';
import { LlmProvider } from '../providers/llm.provider';

@Module({
  imports: [SchemaModule],
  controllers: [SqlChatController],
  providers: [
    SqlChatService,
    SqlGeneratorService,
    SqlValidatorService,
    SqlExecutorService,
    LlmProvider,
  ],
})
export class SqlChatModule {}

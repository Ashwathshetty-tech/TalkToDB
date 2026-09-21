import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../schema/schema.service';
import { SqlChatService } from './sql-chat.service';
import { QueryDto } from './dto/query.dto';

@Controller('chat')
export class SqlChatController {
  constructor(
    private readonly sqlChatService: SqlChatService,
    private readonly schemaService: SchemaService,
    private readonly databaseService: DatabaseService,
  ) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  async query(@Body() dto: QueryDto) {
    return this.sqlChatService.ask(dto);
  }

  // Lets you see exactly what the model sees — handy for debugging and for
  // explaining the "schema grounding" step without reading source code.
  @Get('schema')
  async schema() {
    const description = await this.schemaService.getSchemaDescription();
    return {
      allowedTables: this.databaseService.getAllowedTables(),
      description,
    };
  }
}

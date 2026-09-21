import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { SchemaService } from '../schema/schema.service';
import { LlmProvider } from '../providers/llm.provider';
import { SqlGeneratorService } from './sql-generator.service';
import { SqlValidatorService } from './sql-validator.service';
import { SqlExecutorService } from './sql-executor.service';
import { QueryDto } from './dto/query.dto';

export interface SqlChatResult {
  question: string;
  sql: string;
  tablesUsed: string[];
  limitInjected: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  explanation: string;
  attempts: number;
  failed?: boolean;
}

const MAX_ATTEMPTS = 2; // one generation + one self-correcting retry
const RESULT_ROWS_SENT_TO_LLM = 50;

@Injectable()
export class SqlChatService {
  private readonly defaultLimit: number;
  private readonly maxLimit: number;

  constructor(
    private readonly schemaService: SchemaService,
    private readonly databaseService: DatabaseService,
    private readonly generator: SqlGeneratorService,
    private readonly validator: SqlValidatorService,
    private readonly executor: SqlExecutorService,
    private readonly llmProvider: LlmProvider,
    configService: ConfigService,
  ) {
    this.defaultLimit = Number(
      configService.get<string>('DEFAULT_ROW_LIMIT', '200'),
    );
    this.maxLimit = Number(configService.get<string>('MAX_ROW_LIMIT', '1000'));
  }

  async ask(dto: QueryDto): Promise<SqlChatResult> {
    const allowedTables = this.databaseService.getAllowedTables();
    const schemaDescription = await this.schemaService.getSchemaDescription();

    let previousSql: string | undefined;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let rawSql: string;
      try {
        rawSql = await this.generator.generate(
          dto.question,
          schemaDescription,
          allowedTables,
          dto.history ?? [],
          previousSql && lastError
            ? { previousSql, error: lastError }
            : undefined,
        );
      } catch (err) {
        throw new InternalServerErrorException(
          `Failed to reach the model while generating SQL: ${(err as Error).message}`,
        );
      }

      let safeSql: string;
      let tablesUsed: string[] = [];
      let limitInjected = false;
      try {
        const validation = this.validator.validate(
          rawSql,
          allowedTables,
          this.defaultLimit,
          this.maxLimit,
        );
        safeSql = validation.safeSql;
        tablesUsed = validation.tablesUsed;
        limitInjected = validation.limitInjected;
      } catch (err) {
        previousSql = rawSql;
        lastError = (err as Error).message;
        if (attempt === MAX_ATTEMPTS) {
          return this.failure(dto.question, rawSql, lastError, attempt);
        }
        continue;
      }

      try {
        const result = await this.executor.execute(safeSql);
        const explanation = await this.explain(dto.question, safeSql, result);

        return {
          question: dto.question,
          sql: safeSql,
          tablesUsed,
          limitInjected,
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          explanation,
          attempts: attempt,
        };
      } catch (err) {
        previousSql = safeSql;
        lastError = (err as Error).message;
        if (attempt === MAX_ATTEMPTS) {
          return this.failure(dto.question, safeSql, lastError, attempt);
        }
      }
    }

    // Unreachable, but keeps TypeScript happy about the return type.
    throw new InternalServerErrorException('Unexpected error in SQL chat pipeline.');
  }

  private failure(
    question: string,
    sql: string,
    error: string,
    attempts: number,
  ): SqlChatResult {
    return {
      question,
      sql,
      tablesUsed: [],
      limitInjected: false,
      columns: [],
      rows: [],
      rowCount: 0,
      explanation: `I couldn't get a working query after ${attempts} attempt(s). Last error: ${error}`,
      attempts,
      failed: true,
    };
  }

  private async explain(
    question: string,
    sql: string,
    result: { columns: string[]; rows: Record<string, unknown>[]; rowCount: number },
  ): Promise<string> {
    const truncated = result.rows.length > RESULT_ROWS_SENT_TO_LLM;
    const sample = result.rows.slice(0, RESULT_ROWS_SENT_TO_LLM);

    const system = `You explain SQL query results in plain English for a non-technical reader.
You are given the original question, the SQL that was run, and the resulting
rows as JSON. Answer using ONLY these results — never invent a number that
isn't present in the data. If the result set is empty, say so plainly rather
than guessing why. Be concise: 1-3 sentences, unless the data genuinely
calls for a short list.`;

    const userMessage = `Question: ${question}

SQL that was run:
${sql}

Result rows (JSON)${truncated ? ` — showing first ${RESULT_ROWS_SENT_TO_LLM} of ${result.rowCount}` : ''}:
${JSON.stringify(sample)}`;

    return this.llmProvider.complete(system, [
      { role: 'user', content: userMessage },
    ]);
  }
}

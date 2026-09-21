import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

export interface ExecutionResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

@Injectable()
export class SqlExecutorService {
  private readonly timeoutMs: number;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {
    this.timeoutMs = Number(
      this.configService.get<string>('QUERY_TIMEOUT_MS', '5000'),
    );
  }

  async execute(safeSql: string): Promise<ExecutionResult> {
    try {
      const result = await this.databaseService.readonlyQuery(
        safeSql,
        this.timeoutMs,
      );
      const columns = result.fields?.map((f) => f.name) ?? [];
      return {
        columns,
        rows: result.rows,
        rowCount: result.rowCount ?? result.rows.length,
      };
    } catch (err) {
      const pgError = err as { message?: string };
      // Re-thrown as a plain Error with Postgres's message intact — the
      // orchestrator uses this text to drive the one-shot retry loop, and
      // it's also safe to show the user since it's just Postgres explaining
      // what's wrong with the query (e.g. "column x does not exist").
      throw new Error(pgError.message ?? 'Query execution failed');
    }
  }
}

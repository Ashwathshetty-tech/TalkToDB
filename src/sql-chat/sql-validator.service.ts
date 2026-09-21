import { BadRequestException, Injectable } from '@nestjs/common';
import { Parser } from 'node-sql-parser';

export interface ValidationResult {
  safeSql: string;
  tablesUsed: string[];
  limitInjected: boolean;
}

@Injectable()
export class SqlValidatorService {
  private readonly parser = new Parser();
  private readonly dialectOpts = { database: 'postgresql' } as const;

  validate(
    rawSql: string,
    allowedTables: string[],
    defaultLimit: number,
    maxLimit: number,
  ): ValidationResult {
    const sql = rawSql.trim();
    if (!sql) {
      throw new BadRequestException('The model returned an empty query.');
    }

    let ast: any;
    try {
      ast = this.parser.astify(sql, this.dialectOpts);
    } catch (err) {
      throw new BadRequestException(
        `Generated SQL could not be parsed: ${(err as Error).message}`,
      );
    }

    // A trailing semicolon alone still parses to a one-element array; more
    // than one element means genuinely separate statements were chained.
    const statements = Array.isArray(ast) ? ast : [ast];
    if (statements.length > 1) {
      throw new BadRequestException(
        'Generated SQL contains multiple statements, which is not allowed.',
      );
    }
    const statement = statements[0];

    if (statement.type !== 'select') {
      throw new BadRequestException(
        `Only SELECT statements are allowed (the model produced "${statement.type}").`,
      );
    }

    if (statement.into?.position != null) {
      throw new BadRequestException(
        'SELECT INTO is not allowed (it creates a table).',
      );
    }

    // tableList() walks the whole AST — joins, subqueries, CTE bodies — and
    // tags each reference with the operation type, so this single call does
    // double duty: it's both our table allowlist check AND a second,
    // independent confirmation that nothing non-SELECT is hiding anywhere
    // in the query (e.g. inside a subquery the top-level type check can't see).
    const cteNames = new Set<string>(
      (statement.with ?? []).map((cte: any) =>
        String(cte.name?.value ?? '').toLowerCase(),
      ),
    );

    const allowedSet = new Set(allowedTables.map((t) => t.toLowerCase()));
    const tablesUsed = new Set<string>();

    const refs: string[] = this.parser.tableList(sql, this.dialectOpts);
    for (const ref of refs) {
      const parts = ref.split('::');
      const opType = parts[0].toLowerCase();
      const table = parts[parts.length - 1].toLowerCase();

      if (opType !== 'select') {
        throw new BadRequestException(
          `Query contains a non-SELECT operation ("${opType}") on table "${table}".`,
        );
      }

      if (!cteNames.has(table)) {
        tablesUsed.add(table);
        if (!allowedSet.has(table)) {
          throw new BadRequestException(
            `Query references table "${table}", which isn't in the allowed list (${allowedTables.join(', ')}).`,
          );
        }
      }
    }

    const limitInjected = this.enforceLimit(statement, defaultLimit, maxLimit);

    const safeSql = this.parser.sqlify(statement, this.dialectOpts);

    return { safeSql, tablesUsed: Array.from(tablesUsed), limitInjected };
  }

  /** Mutates statement.limit in place; returns true if it changed anything. */
  private enforceLimit(
    statement: any,
    defaultLimit: number,
    maxLimit: number,
  ): boolean {
    const currentValue = statement.limit?.value?.[0]?.value;

    if (currentValue == null) {
      statement.limit = {
        seperator: '',
        value: [{ type: 'number', value: defaultLimit }],
      };
      return true;
    }

    if (typeof currentValue === 'number' && currentValue > maxLimit) {
      statement.limit.value[0].value = maxLimit;
      return true;
    }

    return false;
  }
}

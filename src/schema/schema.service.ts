import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface ColumnInfo {
  table: string;
  column: string;
  dataType: string;
  isNullable: boolean;
}

interface ForeignKeyInfo {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
}

@Injectable()
export class SchemaService {
  private readonly logger = new Logger(SchemaService.name);
  private cachedDescription: string | null = null;

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Returns a compact, LLM-friendly text description of the allowed tables.
   * Cached after first build; call with forceRefresh if the schema changes
   * at runtime (this boilerplate never does, but a real app might).
   */
  async getSchemaDescription(forceRefresh = false): Promise<string> {
    if (this.cachedDescription && !forceRefresh) {
      return this.cachedDescription;
    }

    const allowedTables = this.databaseService.getAllowedTables();
    const columns = await this.fetchColumns(allowedTables);
    const foreignKeys = await this.fetchForeignKeys(allowedTables);
    const primaryKeys = await this.fetchPrimaryKeys(allowedTables);

    this.cachedDescription = this.render(
      allowedTables,
      columns,
      primaryKeys,
      foreignKeys,
    );
    this.logger.log('Schema description built and cached');
    return this.cachedDescription;
  }

  private async fetchColumns(tables: string[]): Promise<ColumnInfo[]> {
    const { rows } = await this.databaseService
      .getReadonlyPool()
      .query(
        `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1)
         ORDER BY table_name, ordinal_position`,
        [tables],
      );

    return rows.map((r) => ({
      table: r.table_name,
      column: r.column_name,
      dataType: r.data_type,
      isNullable: r.is_nullable === 'YES',
    }));
  }

  private async fetchPrimaryKeys(tables: string[]): Promise<Set<string>> {
    const { rows } = await this.databaseService.getReadonlyPool().query(
      `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name = ANY($1)`,
      [tables],
    );
    return new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  }

  private async fetchForeignKeys(tables: string[]): Promise<ForeignKeyInfo[]> {
    const { rows } = await this.databaseService.getReadonlyPool().query(
      `SELECT
          tc.table_name AS table_name,
          kcu.column_name AS column_name,
          ccu.table_name AS ref_table,
          ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name = ANY($1)`,
      [tables],
    );

    return rows.map((r) => ({
      table: r.table_name,
      column: r.column_name,
      refTable: r.ref_table,
      refColumn: r.ref_column,
    }));
  }

  private render(
    tables: string[],
    columns: ColumnInfo[],
    primaryKeys: Set<string>,
    foreignKeys: ForeignKeyInfo[],
  ): string {
    const lines: string[] = [];

    for (const table of tables) {
      lines.push(`Table: ${table}`);
      const tableColumns = columns.filter((c) => c.table === table);

      for (const col of tableColumns) {
        const fk = foreignKeys.find(
          (f) => f.table === table && f.column === col.column,
        );
        const isPk = primaryKeys.has(`${table}.${col.column}`);
        const tags = [
          isPk ? 'PRIMARY KEY' : null,
          fk ? `REFERENCES ${fk.refTable}(${fk.refColumn})` : null,
          col.isNullable ? null : 'NOT NULL',
        ]
          .filter(Boolean)
          .join(', ');

        lines.push(
          `  - ${col.column} (${col.dataType})${tags ? ` [${tags}]` : ''}`,
        );
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }
}

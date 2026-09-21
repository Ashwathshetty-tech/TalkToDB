import { Injectable } from '@nestjs/common';
import { LlmProvider, ChatMessage } from '../providers/llm.provider';
import { HistoryTurnDto } from './dto/query.dto';

interface RetryContext {
  previousSql: string;
  error: string;
}

function systemPrompt(schemaDescription: string, allowedTables: string[]): string {
  return `You translate a person's plain-English question into a single PostgreSQL SELECT statement.

Database schema (the ONLY tables and columns that exist for this purpose):
${schemaDescription}

Rules, in order of importance:
1. Output ONLY the SQL statement. No prose, no explanation, no markdown code fences.
2. Generate exactly one statement. Never chain multiple statements with semicolons.
3. Only ever write a SELECT. Never INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE,
   CREATE, GRANT, or anything that isn't a read.
4. Only reference these tables: ${allowedTables.join(', ')}. Never reference any
   other table, even if you believe it might exist.
5. If the question can't be answered with these tables, write a SELECT that
   returns no meaningful rows (e.g. "SELECT NULL WHERE false") rather than
   guessing at a schema that isn't shown above.
6. Prefer explicit column lists over SELECT * when practical.
7. If the question is ambiguous, make the most reasonable assumption and
   proceed — do not ask a clarifying question, since your output must be SQL.`;
}

@Injectable()
export class SqlGeneratorService {
  constructor(private readonly llmProvider: LlmProvider) {}

  async generate(
    question: string,
    schemaDescription: string,
    allowedTables: string[],
    history: HistoryTurnDto[] = [],
    retry?: RetryContext,
  ): Promise<string> {
    const messages: ChatMessage[] = [];

    for (const turn of history) {
      messages.push({ role: 'user', content: turn.question });
      messages.push({ role: 'assistant', content: turn.sql });
    }

    let finalUserMessage = question;
    if (retry) {
      finalUserMessage = `${question}

Your previous attempt was:
${retry.previousSql}

That failed with this error from Postgres:
${retry.error}

Write a corrected query. Output only the corrected SQL.`;
    }
    messages.push({ role: 'user', content: finalUserMessage });

    const raw = await this.llmProvider.complete(
      systemPrompt(schemaDescription, allowedTables),
      messages,
    );

    return this.stripCodeFences(raw);
  }

  // Models frequently wrap SQL in ```sql fences despite instructions not to.
  // Strip defensively rather than relying on the prompt alone.
  private stripCodeFences(text: string): string {
    const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
    return (fenced ? fenced[1] : text).trim();
  }
}

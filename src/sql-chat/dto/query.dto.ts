import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class HistoryTurnDto {
  @IsString()
  @MinLength(1)
  question: string;

  @IsString()
  @MinLength(1)
  sql: string;
}

export class QueryDto {
  @IsString()
  @MinLength(1)
  question: string;

  // Optional prior turns in this conversation, so follow-ups like
  // "now just show the cancelled ones" have something to refer to.
  // Stateless by design — the client owns history, the server doesn't.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoryTurnDto)
  history?: HistoryTurnDto[];
}

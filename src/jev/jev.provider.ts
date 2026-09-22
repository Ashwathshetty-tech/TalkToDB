import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface JevQuestion {
  type: 'noul' | 'choice' | 'score';
  instructions: string | Record<string, unknown>;
  criteria?: unknown;
}

export interface JevNoulAnswer {
  type: 'noul';
  noul: number; // 0..1
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevNoulAnswer | { type: string; [key: string]: unknown }>;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Wraps TypeSafe AI's System One endpoint (Jev). Unlike LlmProvider, this
 * model never generates text — you send `state` + typed `questions` and get
 * back typed answers with confidence, in a single low-latency round trip.
 * See: https://docs.typesafe.ai/api
 */
@Injectable()
export class JevProvider {
  private readonly logger = new Logger(JevProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;

  /** False when no API key is configured — callers should degrade gracefully. */
  readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'JEV_BASE_URL',
      'https://api.typesafe.ai',
    );
    this.apiKey = this.configService.get<string>('JEV_API_KEY');
    this.model = this.configService.get<string>('JEV_MODEL', 'jev-latest');
    const flagEnabled =
      this.configService.get<string>('JEV_ENABLED', 'false') === 'true';
    this.enabled = flagEnabled && !!this.apiKey;

    if (flagEnabled && !this.apiKey) {
      this.logger.warn(
        'JEV_ENABLED=true but JEV_API_KEY is not set — Jev gate will be skipped.',
      );
    }
  }

  async systemOne(
    state: unknown,
    questions: Record<string, JevQuestion>,
  ): Promise<JevResponse> {
    const res = await fetch(`${this.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state, model: this.model, questions }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Jev request failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<JevResponse>;
  }
}

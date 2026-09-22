import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/chat/schema (GET) returns the allowed tables and description', () => {
    return request(app.getHttpServer())
      .get('/chat/schema')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body.allowedTables)).toBe(true);
        expect(typeof res.body.description).toBe('string');
      });
  });
});

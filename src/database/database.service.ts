import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { randomUUID } from 'crypto';

const FIRST_NAMES = [
  'Ava', 'Liam', 'Noah', 'Emma', 'Oliver', 'Sophia', 'Mateo', 'Isabella',
  'Lucas', 'Mia', 'Ethan', 'Amara',
];
const LAST_NAMES = [
  'Nguyen', 'Garcia', 'Smith', 'Patel', 'Kim', 'Rossi', 'Okafor', 'Muller',
  'Silva', 'Johansson', 'Chen', 'Diaz',
];
const REGIONS = ['North America', 'Europe', 'Asia Pacific', 'South America'];

const PRODUCTS: Array<[string, string, number]> = [
  ['Trail Running Shoes', 'Footwear', 89.99],
  ['Insulated Water Bottle', 'Accessories', 24.5],
  ['Merino Wool Socks', 'Apparel', 14.0],
  ['Lightweight Rain Jacket', 'Apparel', 129.0],
  ['Camping Headlamp', 'Gear', 32.75],
  ['Trekking Poles (Pair)', 'Gear', 54.99],
  ['Compression Backpack 30L', 'Gear', 149.0],
  ['Sport Sunglasses', 'Accessories', 69.5],
];

const ORDER_STATUSES = ['pending', 'shipped', 'delivered', 'cancelled'];

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  // Used only at boot: create schema, seed sample data, provision the
  // read-only role. Never used to run a model-generated query.
  private adminPool: Pool;

  // The ONLY connection SqlExecutorService touches. Scoped to a Postgres
  // role that is granted SELECT on the allowed tables and nothing else.
  private readonlyPool: Pool;

  private allowedTables: string[];

  constructor(private readonly configService: ConfigService) {
    this.adminPool = new Pool({
      connectionString: this.configService.get<string>('ADMIN_DATABASE_URL'),
    });
    this.readonlyPool = new Pool({
      connectionString: this.configService.get<string>(
        'READONLY_DATABASE_URL',
      ),
    });
    this.allowedTables = this.configService
      .get<string>('ALLOWED_TABLES', 'customers,products,orders,order_items')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async onModuleInit() {
    await this.ensureSchema();
    await this.seedIfEmpty();
    await this.ensureReadonlyRole();
  }

  async onModuleDestroy() {
    await this.adminPool.end();
    await this.readonlyPool.end();
  }

  getAllowedTables(): string[] {
    return this.allowedTables;
  }

  /** Admin connection — schema/seed/role management only. */
  async adminQuery<T extends QueryResultRow = any>(
    text: string,
    params?: any[],
  ): Promise<QueryResult<T>> {
    return this.adminPool.query<T>(text, params);
  }

  /**
   * The ONLY method the SQL executor is allowed to call. Runs inside a
   * READ ONLY transaction with a per-statement timeout as belt-and-braces
   * on top of the role-level restrictions already in place.
   */
  async readonlyQuery<T extends QueryResultRow = any>(
    text: string,
    timeoutMs: number,
  ): Promise<QueryResult<T>> {
    const client = await this.readonlyPool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
      const result = await client.query<T>(text);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Introspection also goes through the read-only role, so the schema
   * description shown to the model always matches exactly what the
   * executor is actually permitted to see — no drift between the two. */
  getReadonlyPool(): Pool {
    return this.readonlyPool;
  }

  private async ensureSchema() {
    await this.adminPool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        region TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await this.adminPool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await this.adminPool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY,
        customer_id UUID NOT NULL REFERENCES customers(id),
        status TEXT NOT NULL CHECK (status IN ('pending','shipped','delivered','cancelled')),
        order_date DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await this.adminPool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id),
        product_id UUID NOT NULL REFERENCES products(id),
        quantity INT NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(10,2) NOT NULL
      )
    `);

    this.logger.log('Schema ready (customers, products, orders, order_items)');
  }

  private async seedIfEmpty() {
    const { rows } = await this.adminPool.query(
      'SELECT count(*)::int AS count FROM customers',
    );
    if (rows[0].count > 0) {
      this.logger.log('Sample data already present, skipping seed');
      return;
    }

    this.logger.log('Seeding sample business data…');

    const customerIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const first = FIRST_NAMES[i % FIRST_NAMES.length];
      const last = LAST_NAMES[(i * 3) % LAST_NAMES.length];
      const id = randomUUID();
      customerIds.push(id);
      await this.adminPool.query(
        `INSERT INTO customers (id, name, email, region) VALUES ($1,$2,$3,$4)`,
        [
          id,
          `${first} ${last}`,
          `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
          REGIONS[i % REGIONS.length],
        ],
      );
    }

    const productIds: string[] = [];
    for (const [name, category, price] of PRODUCTS) {
      const id = randomUUID();
      productIds.push(id);
      await this.adminPool.query(
        `INSERT INTO products (id, name, category, price) VALUES ($1,$2,$3,$4)`,
        [id, name, category, price],
      );
    }

    const today = new Date();
    for (let i = 0; i < 60; i++) {
      const orderId = randomUUID();
      const customerId =
        customerIds[Math.floor(Math.random() * customerIds.length)];
      const status =
        ORDER_STATUSES[Math.floor(Math.random() * ORDER_STATUSES.length)];
      const daysAgo = Math.floor(Math.random() * 120);
      const orderDate = new Date(today);
      orderDate.setDate(orderDate.getDate() - daysAgo);

      await this.adminPool.query(
        `INSERT INTO orders (id, customer_id, status, order_date) VALUES ($1,$2,$3,$4)`,
        [orderId, customerId, status, orderDate.toISOString().slice(0, 10)],
      );

      const itemCount = 1 + Math.floor(Math.random() * 3);
      const usedProducts = new Set<string>();
      for (let j = 0; j < itemCount; j++) {
        let idx = Math.floor(Math.random() * PRODUCTS.length);
        while (usedProducts.has(productIds[idx]) && usedProducts.size < PRODUCTS.length) {
          idx = Math.floor(Math.random() * PRODUCTS.length);
        }
        usedProducts.add(productIds[idx]);
        const [, , price] = PRODUCTS[idx];
        const quantity = 1 + Math.floor(Math.random() * 3);

        await this.adminPool.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
           VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), orderId, productIds[idx], quantity, price],
        );
      }
    }

    this.logger.log('Seed complete: 12 customers, 8 products, 60 orders');
  }

  /**
   * Creates (if missing) a Postgres role scoped to exactly SELECT on the
   * allowed tables. This is the real safety boundary — even a bug in the
   * app's SQL validator can't turn into a write, because the DB connection
   * used to execute generated SQL is physically incapable of one.
   */
  private async ensureReadonlyRole() {
    const password = this.configService.get<string>('READONLY_DB_PASSWORD');
    if (!password) {
      throw new Error('READONLY_DB_PASSWORD is not configured');
    }

    const escapedPassword = password.replace(/'/g, "''");

    const { rows } = await this.adminPool.query(
      `SELECT 1 FROM pg_roles WHERE rolname = 'sql_chat_readonly'`,
    );

    if (rows.length === 0) {
      await this.adminPool.query(
        `CREATE ROLE sql_chat_readonly LOGIN PASSWORD '${escapedPassword}'`,
      );
      this.logger.log('Created read-only role sql_chat_readonly');
    }

    await this.adminPool.query(
      `ALTER ROLE sql_chat_readonly SET statement_timeout = '10000'`,
    );
    await this.adminPool.query(`GRANT USAGE ON SCHEMA public TO sql_chat_readonly`);

    // Revoke first so this stays correct even if ALLOWED_TABLES shrinks
    // between restarts — the grant always exactly matches the allowlist.
    await this.adminPool.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sql_chat_readonly`,
    );

    if (this.allowedTables.length > 0) {
      const tableList = this.allowedTables.join(', ');
      await this.adminPool.query(
        `GRANT SELECT ON ${tableList} TO sql_chat_readonly`,
      );
    }

    this.logger.log(
      `sql_chat_readonly granted SELECT on: ${this.allowedTables.join(', ')}`,
    );
  }
}

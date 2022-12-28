import knex, { Knex } from 'knex';
import { Log } from "./Log";

export const STATUS_ID_CACHE_TABLE = 'status_id_cache';
export const LAST_TWEET_ID_TABLE = 'last_tweet_id';
export const CACHE_DB_FILE = 'cache.db';

export class DBCache {
	public static knex: Knex;

	public static async init() {
        Log.info(`Setting up db cache`);

		DBCache.knex = knex({
			client: 'sqlite3',
			useNullAsDefault: true,
			connection: {
				filename: CACHE_DB_FILE
			}
		});

		await DBCache.createTables();

        Log.info(`Done setting up db cache`);
	}

	private static async createTables() {
		if(!(await DBCache.knex.schema.hasTable(STATUS_ID_CACHE_TABLE))) {
            Log.info(`No status id cache table found. Creating it.`);

            await DBCache.knex.schema.createTable(STATUS_ID_CACHE_TABLE, (table) => {
                table.string('tweetId').primary();
                table.string('statusId').unique().notNullable();
                table.timestamps({
                    defaultToNow: true,
                    useCamelCase: true
                });
            });
		}

        if(!(await DBCache.knex.schema.hasTable(LAST_TWEET_ID_TABLE))) {
            Log.info(`No last tweet id cache table found. Creating it.`);

            await DBCache.knex.schema.createTable(LAST_TWEET_ID_TABLE, (table) => {
                table.increments('id').primary().notNullable();
                table.string('tweetId').unique().nullable();
                table.timestamps({
                    defaultToNow: true,
                    useCamelCase: true
                });
            });

            await DBCache.knex.insert({ id: 0, tweetId: null }).into((LAST_TWEET_ID_TABLE));
        }
	}

    public static async insertStatusId(tweetId: string, statusId: string) {
        return DBCache.knex.insert({ tweetId, statusId }).into(STATUS_ID_CACHE_TABLE);
    }

    public static async getStatusId(tweetId: string) {
        const result = await DBCache.knex.select().table(STATUS_ID_CACHE_TABLE).where({ tweetId }).limit(1);
        if(result.length > 0) {
            return result[0].statusId;
        }
    }

    public static async updateLastTweetId(tweetId: string) {
        return DBCache.knex(LAST_TWEET_ID_TABLE).where({ id: 0 }).update({ tweetId });
    }

    public static async getLastTweetId() {
        const result = await DBCache.knex.select().table(LAST_TWEET_ID_TABLE).where({ id: 0 }).limit(1);
        if(result.length > 0) {
            return result[0].tweetId;
        }
    }
}

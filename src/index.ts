import { Log } from './Log';
import { Mastodon } from './Mastodon';
import fs from 'fs';
import { Twitter } from './Twitter';
import path from 'path';
import config from 'config';
import { LinkShortener } from './LinkShortener';
import { DBCache } from './DBCache';

export const tmpFolder = path.join(__dirname, '/../', '/tmp');

let running = false;
const syncTweets = async () => {
	if(running) return;
	running = true;

	Log.debug(`Looking for new tweets`);

	try {
		if(!fs.existsSync(tmpFolder)) {
			fs.mkdirSync(tmpFolder);
		}

		const tweets = await Twitter.getTweets();

		if(tweets.length > 0) {

			const replies = tweets.filter(tweet => tweet.referencedTweet);
			const actualTweets = tweets.filter(tweet => !tweet.referencedTweet);

			Log.info(`We have ${actualTweets.length} actual tweets and ${replies.length} replies`);

			for(const tweet of actualTweets) {
				try {
					await Mastodon.createStatus(tweet);
				} catch (error) {
					Log.error(error.message);
				}
			}

			for(const reply of replies) {
				try {
					await Mastodon.createStatus(reply);
				} catch (error) {
					Log.error(error.message);
				}
			}
		}

	} catch (error) {
		Log.error(error);
	} finally {
		if(fs.existsSync(tmpFolder)) {
			fs.rmSync(tmpFolder, { recursive: true });
		}
		await Mastodon.updateProfile();
		running = false;
	}
}

(async () => {
    try {
		Log.info(`Booting Twitter to Mastodon Bot Version ${process.env.npm_package_version}`);

		const refreshMillis = config.get("refreshMillis") as number;

		Log.debug(`Setting tmpFolder to ${tmpFolder}`);

		//await DBCache.init();
		//await LinkShortener.init();
		//await Mastodon.init();
		await Twitter.init();

		console.log(JSON.stringify((await Twitter.twitterClient.tweets.usersIdTweets(Twitter.twitterAccountId, {
			exclude: [
				'replies',
				'retweets'
			],
			expansions: [
				'attachments.media_keys'
			],
			'media.fields': [
				'url',
				'variants'
			],
			'tweet.fields': [
				'created_at',
				'entities',
				'referenced_tweets'
			]
		})).data, null, 2));

		//await syncTweets();
		//setInterval(syncTweets, refreshMillis);
    } catch (error: any) {
        Log.error(`Error occured: ${error}`);
    }
})();

import { Log } from './Log';
import { Mastodon } from './Mastodon';
import fs from 'fs';
import path from 'path';
import config from 'config';
import { DBCache } from './DBCache';
import { Nitter } from './Nitter';

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

		const tweets = await Nitter.getTweets();

		if(tweets?.length > 0) {
			for(const tweet of tweets) {
				try {
					await Mastodon.createStatus(tweet);
				} catch (error) {
					Log.error(error.message);
				}
			}
		}
	} catch (error) {
		Log.error(`Error occured: ${error}`);
	} finally {
		if(fs.existsSync(tmpFolder)) {
			fs.rmSync(tmpFolder, { recursive: true });
		}
		try {
			await Mastodon.updateProfile();
		} catch (error) {
			Log.error(`Failed to update profile: ${error}`);
		}
		running = false;
	}
};

(async () => {
	Log.info(`Booting Nitter to Mastodon Bot Version ${process.env.npm_package_version}`);

	const refreshMillis = config.get("refreshMillis") as number;

	Log.debug(`Setting tmpFolder to ${tmpFolder}`);

	await DBCache.init();
	//await LinkShortener.init();
	await Mastodon.init();
	await Nitter.init();

	await syncTweets();
	setInterval(syncTweets, refreshMillis);
})();

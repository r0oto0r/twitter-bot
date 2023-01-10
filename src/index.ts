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
			for(const tweet of tweets) {
				try {
					await Mastodon.createStatus(tweet);
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

		await DBCache.init();
		await LinkShortener.init();
		await Mastodon.init();
		await Twitter.init();

		await syncTweets();
		setInterval(syncTweets, refreshMillis);
    } catch (error: any) {
        Log.error(`Error occured: ${error}`);
    }
})();

import { Log } from './Log';
import { Mastodon } from './Mastodon';
import fs from 'fs';
import { Twitter } from './Twitter';
import path from 'path';
import config from 'config';

export const tmpFolder = path.join(__dirname, '/../', '/tmp');

let running = false;
const syncTweets = async () => {
	if(running) return;
	running = true;

	Log.info(`Looking for new tweets`);

	try {
		if(!fs.existsSync(tmpFolder)) {
			fs.mkdirSync(tmpFolder);
		}

		const tweets = await Twitter.getTweets();

		if(tweets.length > 0) {
			for(const tweet of tweets) {
				const { id, text, downloadedFilePaths } = tweet;
				try {
					await Mastodon.createStatus(id, text, downloadedFilePaths);
				} catch (error) {
					Log.error(error);
				}
			}
		}

	} catch (error) {
		Log.error(error);
	} finally {
		if(fs.existsSync(tmpFolder)) {
			fs.rmSync(tmpFolder, { recursive: true });
		}
		running = false;
	}
}

(async () => {
    try {
		Log.info(`Booting Twitter to Mastodon Bot`);

		const refreshMillis = config.get("refreshMillis") as number;

		Log.debug(`Setting tmpFolder to ${tmpFolder}`);

		await Mastodon.init();
		await Twitter.init();

		await syncTweets();
		setInterval(syncTweets, refreshMillis);
    } catch (error: any) {
        Log.error(`Error occured: ${error}`);
    }
})();

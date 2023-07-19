import { Log } from "./Log";
import { XMLParser} from "fast-xml-parser";
import axios from "axios";
import config from "config";
import { AttachedMedia, PreparedTweet } from "./Mastodon";
import { DBCache } from "./DBCache";
import { tmpFolder } from ".";
import fs from 'fs';
import stream from 'stream/promises';
const m3u8ToMp4 = require("m3u8-to-mp4");
const converter = new m3u8ToMp4();

export interface ParsedNitterTweet {
	id: string;
	referencedTweet: string;
	text: string;
	description: string;
	link: string;
};

export class Nitter {
	private static twitterUserName: string;
	private static parser: XMLParser;
	private static fakeUserAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

	public static async init() {
		Log.info(`Setting up nitter client`);

		this.twitterUserName = config.get('twitterUserName');
		this.parser = new XMLParser();

		Log.info(`Done setting up nitter client`);
	}

	private static async getRSSFromRandomNitterInstance(): Promise<{ rssData: any; nitterBaseUrl: string }> {
		const nitterInstances = config.get('nitterInstances') as Array<string>;
		let randomIndex = Math.floor(Math.random() * nitterInstances.length);
		let instanceAvailable = false;
		let instanceIndex = 0;
		let rssData = null;

		while(!instanceAvailable) {
			const instance = nitterInstances[randomIndex];
			try {
				const response = await axios.get(`${instance}/${this.twitterUserName}/rss`, {
					headers: {
						'User-Agent': this.fakeUserAgent
					}
				});
				if(response.status === 200) {
					instanceAvailable = true;
					rssData = response.data;
				}
			} catch (error) {
				Log.error(`Instance ${instance} not available`);
				instanceIndex++;
				randomIndex = (randomIndex + instanceIndex) % nitterInstances.length;
			}
		}

		return { rssData, nitterBaseUrl: nitterInstances[randomIndex] };
	}

	public static async getTweets(): Promise<Array<PreparedTweet>> {
		let lastTweetId = await DBCache.getLastTweetId();
		const fetchedTweets = new Array<PreparedTweet>();

		try {
			const { rssData, nitterBaseUrl } = await this.getRSSFromRandomNitterInstance();

			if(!rssData) {
				Log.error(`No RSS data found. ${nitterBaseUrl}`);
				return;
			}

			const jObj = this.parser.parse(rssData);

			if(jObj?.rss?.channel?.item?.length < 1) {
				Log.error(`No tweets found in RSS feed. ${nitterBaseUrl}`);
				return;
			}

			let parsedNitterTweets = new Array<ParsedNitterTweet>();

			for(const item of jObj.rss.channel.item) {
				const tweetIdRegex = /\/status\/(\d*)#m/gm;
				let match = tweetIdRegex.exec(item.link);
				if(!match || match.length < 2) {
					Log.error(`Could not find status id in ${item.link}`);
					continue;
				}
				const tweetId = match[1];
				parsedNitterTweets.push({
					id: tweetId,
					referencedTweet: null,
					text: item.title,
					description: item.description,
					link: item.link
				});
			}

			let lastParentTweetId: string = null;
			for(let i = 0; i < parsedNitterTweets.length; i++) {
				const parsedNitterTweet = parsedNitterTweets[i];
				if(parsedNitterTweet.text.startsWith(`R to @${this.twitterUserName}: `)) {
					if(!lastParentTweetId) {
						Log.error(`Found reply to tweet but no parent tweet found. Skipping it.`);
						continue;
					}
					const referencedNitterTweetIndex = parsedNitterTweets.findIndex((t) => t.id === lastParentTweetId);
					if(referencedNitterTweetIndex > -1) {
						parsedNitterTweet.referencedTweet = lastParentTweetId;
						const referencedTweet = parsedNitterTweets[referencedNitterTweetIndex];
						parsedNitterTweet.text = parsedNitterTweet.text.replace(`R to @${this.twitterUserName}: `, '');
						parsedNitterTweets[referencedNitterTweetIndex] = parsedNitterTweet;
						parsedNitterTweets[i] = referencedTweet;
					}
				}

				lastParentTweetId = parsedNitterTweet.id;
			}

			for(let i = 0; i < parsedNitterTweets.length; i++) {
				const parsedNitterTweet = parsedNitterTweets[i];
				if(parsedNitterTweet.referencedTweet && parsedNitterTweets[i + 1]?.referencedTweet) {
					const nextReferencedTweet = parsedNitterTweets[i + 1];
					parsedNitterTweets[i + 1] = parsedNitterTweet;
					parsedNitterTweets[i] = nextReferencedTweet;
				}
			}

			// console.log(JSON.stringify(parsedNitterTweets, null, 2));

			if(!lastTweetId && parsedNitterTweets.length > 0) {
				lastTweetId = parsedNitterTweets[0].id;
				Log.warn(`Setting last tweet id to ${lastTweetId}.`);
			}

			if(!lastTweetId || lastTweetId.length < 1) {
				Log.error(`No last tweet found.  ${nitterBaseUrl}`);
				return;
			}

			const lastTweetIndex = parsedNitterTweets.findIndex((item: ParsedNitterTweet) => {
				return item.id === lastTweetId;
			});
			const newTweets = parsedNitterTweets.slice(0, lastTweetIndex);

			if(newTweets.length < 1) {
				Log.info(`No new tweets found.  ${nitterBaseUrl}`);
				return;
			} else {
				Log.info(`Found ${newTweets.length} new tweets.  ${nitterBaseUrl}`);
			}

			for(const tweet of newTweets) {
				Log.info(`Processing tweet ${tweet.id}`);
				Log.info(`Tweet text: ${tweet.text}`);

				const attachedMedia = new Array<AttachedMedia>();

				const videoInDescription = tweet.description.includes("ext_tw_video_thumb");
				if(videoInDescription) {
					Log.info(`Video in description`);
					const videoUrlRegex = /data-url="([^"]*)"/gm;

					const nitterPost = await axios.get(`${nitterBaseUrl}/${this.twitterUserName}/status/${tweet.id}#m`, {
						headers: {
							'User-Agent': this.fakeUserAgent,
							Cookie: "hlsPlayback=on;"
						}
					});

					if(nitterPost.status !== 200) {
						Log.error(`Could not fetch nitter post: ${nitterBaseUrl}/${this.twitterUserName}/status/${tweet.id}#m`);
						continue;
					}

					const match = videoUrlRegex.exec(nitterPost.data);
					const mediaURL = match[1].split('/').pop();

					Log.info(`Downloading video attachment: ${decodeURIComponent(mediaURL)}`);
					const filePath = tmpFolder + '/' + tweet.id + '.mp4';
					await converter.setInputFile(decodeURIComponent(mediaURL))
						.setOutputFile(filePath)
						.start();

					attachedMedia.push({
						filePath
					});
				} else {
					Log.info(`No video in description`)
					const partsOfDescription = tweet.description.split('</p>');
					Log.info(`Parts of description: ${partsOfDescription.length}`);
					if(partsOfDescription.length > 1 && partsOfDescription[1].includes('<img src="')) {
						const mediaURLRegex = /<img src="([^"]*)"/gm;
						const mediaURLs = [...partsOfDescription[1].matchAll(mediaURLRegex)];
						if(mediaURLs.length < 1) {
							// should never happen!
							Log.error(`Could not find media url in ${partsOfDescription[1]}`);
							continue;
						}
						for(const mediaURLMatches of mediaURLs) {
							const mediaURL = mediaURLMatches[1];
							Log.info(`Downloading img attachment: ${mediaURL}`);
							const filePath = tmpFolder + '/' + tweet.id + '.jpg';
							const writeStream = fs.createWriteStream(filePath);
							const response = await axios.get(mediaURL, {
								responseType: 'stream',
								headers: {
									'User-Agent': this.fakeUserAgent
								}
							});
							response.data.pipe(writeStream);
							await stream.finished(writeStream);
							attachedMedia.push({
								filePath
							});
						}
					}
				}

				fetchedTweets.push({
					id: tweet.id,
					referencedTweet: tweet.referencedTweet,
					text: tweet.text,
					attachedMedia
				});
			}
		} catch (error) {
			Log.error(error);
		}

		const reversedTweets = fetchedTweets.reverse();
		const newLastTweetId = reversedTweets[reversedTweets.length - 1].id;

		if(newLastTweetId !== lastTweetId) {
			Log.info(`Set last tweet id to: ${newLastTweetId}`);
			try {
				await DBCache.updateLastTweetId(newLastTweetId);
			} catch (error) {
				Log.error(error.message);
			}
		}

		return reversedTweets;
	}
}

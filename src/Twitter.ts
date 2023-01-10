import { Client } from 'twitter-api-sdk';
import { Log } from './Log';
import fs from 'fs';
import axios from 'axios';
import { tmpFolder } from '.';
import config from 'config';
import stream from 'stream/promises';
import { LinkShortener } from './LinkShortener';
import { DBCache } from './DBCache';

export class Twitter {
	public static twitterClient: Client;
	private static twitterAccessToken: string;
	public static twitterAccountId: string;

	public static async init() {
		Log.info(`Setting up twitter client`);

		this.twitterAccessToken = config.get('twitterAccessToken');
		this.twitterAccountId = config.get('twitterAccountId');

		this.twitterClient = new Client(this.twitterAccessToken);

		Log.info(`Done setting up twitter client`);
	}

	public static async getTweets() {
		let cachedTweetId = await DBCache.getLastTweetId();
		let lastTweetId = cachedTweetId;
		let response;

		if(!cachedTweetId || cachedTweetId.length < 1) {
			Log.debug(`No cached tweet id found. Looking it up now.`);
			response = await this.twitterClient.tweets.usersIdTweets(this.twitterAccountId, {
				exclude: [
					'replies',
					'retweets'
				]
			});

			if(response.meta.result_count < 1) {
				Log.error('No last twitter posts found');
				return;
			}

			lastTweetId = response.data[0].id;
		} else {
			Log.debug(`Using cached tweet id: ${lastTweetId}`);
		}

		if(!lastTweetId || lastTweetId.length < 1) {
			Log.error('No last tweet found');
			return;
		}

		response = await this.twitterClient.tweets.usersIdTweets(this.twitterAccountId, {
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
			],
			since_id: lastTweetId
		});

		if(response.meta.result_count < 1) {
			Log.debug('No new tweets found');
		} else {
			Log.info(`Found ${response.meta.result_count} tweets`);
		}

		const fetchedTweets = new Array<any>();

		if(response.data?.length > 0) {
			const tweets = response.data.sort((tweetA, tweetB) => { return new Date(tweetA.created_at).getTime() - new Date(tweetB.created_at).getTime() });

			for(const tweet of tweets) {
				try {
					const { id: tweetId, text, attachments, entities, referenced_tweets } = tweet;

					const downloadedFilePaths = new Array<string>();
					let i = 0;

					if(attachments?.media_keys?.length > 0 && response.includes?.media?.length > 0) {
						const downloadPromisses = new Array<Promise<void>>();
						const tweetMedia = new Array<any>();

						for(const mediaKey of attachments.media_keys) {
							tweetMedia.push(response.includes.media.find(includedMedia => includedMedia.media_key === mediaKey));
						}

						for(const media of tweetMedia) {
							let ending = '';
							let mediaURL = '';
							switch(media.type) {
								case 'photo': 
									ending = '.jpg';
									mediaURL = media.url;
									break;
								case 'video':
									ending = '.mp4';
									mediaURL = media.variants.filter((variant: any) => variant.content_type === 'video/mp4').sort((variantA: any, variantB: any) => variantB.bit_rate - variantA.bit_rate)[0].url;
									break;
								default:
									continue;
							}

							downloadPromisses.push(new Promise<void>(async (resolve, reject) => {
								try {
									Log.debug(`Downloading attachment: ${mediaURL} ${media.type}`);
									const filePath = tmpFolder + '/' + i + '_' + tweetId + ending;
									const writeStream = fs.createWriteStream(filePath);
									const response = await axios.get(mediaURL, {
										responseType: 'stream'
									});
									response.data.pipe(writeStream);
									await stream.finished(writeStream);
									downloadedFilePaths.push(filePath);
									resolve();
								} catch (error) {
									Log.error(error);
									reject();
								}
							}));

							i++;
						}

						await Promise.all(downloadPromisses);
					}

					let groomedText = text;
					if(entities?.urls) {
						for(const url of entities.urls) {
							groomedText = groomedText.replace(url.url, url.expanded_url);
						}
					}

					groomedText = await this.addSourceLink(tweetId, groomedText);

					Log.debug(`Processing tweet id: ${tweetId}`);
					Log.debug(`groomedText: ${groomedText}`);
					Log.debug(`attachments: ${attachments?.media_keys?.length}`);

					const filteredReferencedTweet = referenced_tweets?.filter(tweet => tweet.type === 'replied_to')?.map(tweet => tweet.id)?.[0];

					fetchedTweets.push({
						id: tweetId,
						referencedTweet: filteredReferencedTweet,
						text: groomedText,
						downloadedFilePaths
					});
				} catch (error) {
					Log.error(error.message);
				}
			}

			lastTweetId = response.data[response.data.length - 1].id;
		}

		if(cachedTweetId !== lastTweetId) {
			Log.debug(`Set last tweet id to: ${lastTweetId}`);
			try {
				await DBCache.updateLastTweetId(lastTweetId);
			} catch (error) {
				Log.error(error.message);
			}
		}

		return fetchedTweets;
	}

	private static async addSourceLink(tweetId: string, text : string) {
		const sourceURL = `https://twitter.com/TheRocketBeans/status/${tweetId}`;

		const shortenedURL = await LinkShortener.createShortenedLink(sourceURL);

		return text + `\n\nQuelle: ${shortenedURL ? shortenedURL : sourceURL}`;
	}
}

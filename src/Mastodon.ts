import { Attachment, login, MastoClient } from 'masto';
import { Log } from './Log';
import fs from 'fs';
import config from 'config';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

export class Mastodon {
	private static masto: MastoClient;
	private static twitterHandleRegex = /(@[a-zA-Z0-9_]+)/gm;
	private static urlRegex = /(?:(?:https?|ftp|file):\/\/|www\.|ftp\.)(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[-A-Z0-9+&@#\/%=~_|$?!:,.])*(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[A-Z0-9+&@#\/%=~_|$])/igm;
	private static twitterMediaLinkRegex = /https:\/\/twitter\.com\/TheRocketBeans\/status\/\d*\/(video|photo)\/\d*/gm;
	private static twitterMastodonHandleMap: { [twitterHandle: string]: string };
	private static proxyURL: string;
	private static httpsAgent: HttpsProxyAgent;

	public static async init() {
		Log.info(`Setting up mastodon client`);

		this.twitterMastodonHandleMap = config.get("twitterMastodonHandleMap");
		this.proxyURL = config.get("proxyURL");
		this.httpsAgent = new HttpsProxyAgent(this.proxyURL);

		this.masto = await login({
			url: config.get('mastodonBaseUrl'),
			accessToken: config.get('mastodonAccessToken'),
			timeout: 60 * 5 * 1000
		});

		Log.info(`Done setting up mastodon client`);
	}

	public static async groomText(text: string) {
		text = this.replaceHandles(text);
		text = await this.resolveLinks(text);
		text = this.unEntity(text);
		text = this.removeTwitterMediaLinks(text);
		return text.substring(0, 500);
	}

	private static unEntity(text: string) {
		return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
	}

	private static async resolveLinks(text: string) {
		let result = text;

		try {
			const urls = text.match(this.urlRegex);
			if(urls?.length > 1) {
				const { httpsAgent } = this;

				for(let i = 0; i < urls.length; ++i) {
					const url: string = urls[i];
					let resolvedUrl;
					try {
						const response = await axios.get(url, { httpsAgent });
						resolvedUrl = response?.request?.res?.responseUrl;
					} catch (error) {
						Log.debug(error);
						if(error?.request?.res?.responseUrl) {
							Log.debug(`...but still got a responseUrl!`);
							resolvedUrl = error.request.res.responseUrl;
						}
					}

					if(resolvedUrl && resolvedUrl !== url) {
						Log.info(`Replacing tweet url ${url} with ${resolvedUrl}`);
						result = result.replace(url, resolvedUrl);
					}
				}
			}
		} catch (error) {
			Log.error(error);
		}

		return result;
	}

	private static replaceHandles(text: string) {
		let result = text;
		const twitterHandles = text.matchAll(this.twitterHandleRegex);
		for(const [twitterHandle] of twitterHandles) {
			if(this.twitterMastodonHandleMap && this.twitterMastodonHandleMap[twitterHandle]) {
				result = result.replace(twitterHandle, this.twitterMastodonHandleMap[twitterHandle]);
			} else {
				result = result.replace(twitterHandle, twitterHandle + '@twitter');
			}
		}

		return result;
	}

	private static removeTwitterMediaLinks(text: string) {
		let result = text;
		const twitterMediaLinks = text.matchAll(this.twitterMediaLinkRegex);
		for(const [twitterMediaLink] of twitterMediaLinks) {
				result = result.replace(twitterMediaLink, '');
		}

		return result;
	}

	public static async createStatus(id: string, text: string, downloadedFilePaths: Array<string>) {
		const uploadedMedia = new Array<Attachment>();
		if(downloadedFilePaths?.length > 0) {
			const uploadPromisses = new Array<Promise<void>>();
			for(const path of downloadedFilePaths) {
				uploadPromisses.push(new Promise<void>(async (resolve, reject) => {
					try {
						uploadedMedia.push(await Mastodon.createMediaAttachments(path));
						resolve();
					} catch (error) {
						Log.error(error);
						reject();
					}
				}));
			}
			try {
				await Promise.all(uploadPromisses);
			} catch (error) {
				Log.error(error);
			}
		}

		const groomedText = await this.groomText(text);

		Log.info(`Posting toot for tweet id: ${id}`);
		Log.info(`groomed text: ${groomedText}`);
		Log.info(`attachments: ${downloadedFilePaths?.length} ${downloadedFilePaths} ${uploadedMedia.map(media => media.id)}`);

		await this.masto.statuses.create({
			status: groomedText,
			visibility: process.env.DEBUG ? 'private' : 'public',
			mediaIds: downloadedFilePaths?.length > 0 ? uploadedMedia.map(media => media.id) : undefined
		});
	}

	public static async createMediaAttachments(path: string) {
		if(fs.existsSync(path)) {
			try {
				const file = fs.createReadStream(path);

				const attachment = await this.masto.mediaAttachments.create({
					file
				});

				return attachment;
			} catch (error) {
				Log.error(error);
				throw `Couldn't create media attachment`;
			}
		} else {
			throw `${path} not found!`;
		}
	}
}

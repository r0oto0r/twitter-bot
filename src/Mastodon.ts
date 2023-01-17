import { Attachment, login, MastoClient } from 'masto';
import { Log } from './Log';
import fs from 'fs';
import config from 'config';
import moment from 'moment-timezone';
import { DBCache } from './DBCache';

export class Mastodon {
	private static masto: MastoClient;
	private static twitterHandleRegex = /(@[a-zA-Z0-9_]+)/gm;
	private static twitterMediaLinkRegex = /https:\/\/twitter\.com\/TheRocketBeans\/status\/\d*\/(video|photo)\/\d*/gm;
	private static twitterMastodonHandleMap: { [twitterHandle: string]: string };

	public static async init() {
		Log.info(`Setting up mastodon client`);

		this.twitterMastodonHandleMap = config.get('twitterMastodonHandleMap');

		this.masto = await login({
			url: config.get('mastodonBaseUrl'),
			accessToken: config.get('mastodonAccessToken'),
			timeout: 60 * 5 * 1000
		});

		Log.info(`Done setting up mastodon client`);
	}

	public static async groomText(text: string) {
		text = this.replaceHandles(text);
		text = this.unEntity(text);
		text = this.removeTwitterMediaLinks(text);
		return text.substring(0, 500);
	}

	private static unEntity(text: string) {
		return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
	}

	private static replaceHandles(text: string) {
		let result = text;
		const twitterHandles = text.matchAll(this.twitterHandleRegex);
		const handleSet = new Set<string>();

		for(const [twitterHandle] of twitterHandles) {
			if(!handleSet.has(twitterHandle)) {
				result = result.replaceAll(
					twitterHandle,
					this.twitterMastodonHandleMap?.[twitterHandle] ? this.twitterMastodonHandleMap[twitterHandle] : twitterHandle + '@twtr'
				);
				handleSet.add(twitterHandle);
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

	public static async updateProfile() {
		return this.masto.accounts.updateCredentials({
			fieldsAttributes: [
				{
					name: 'Kontakt',
					value: '@hoschi@mastodon.social'
				},
				{
					name: 'Version',
					value: process.env.npm_package_version
				},
				{
					name: 'Last Sync',
					value: moment().tz("Europe/Berlin").format('DD.MM.YY - HH:mm:ss')
				}
			]
		});
	}

	public static async createStatus(tweet: any) {
		const { id: tweetId, text, attachedMedia, referencedTweet } = tweet;

		const existingStatusId = await DBCache.getStatusId(tweetId);
		if(existingStatusId) {
			Log.warn(`Refusing to repost duplicated tweet for id ${tweetId}.`);
			return;
		}

		let uploadedMedia = new Array<Attachment>();
		if(attachedMedia?.length > 0) {
			const uploadPromisses = new Array<Promise<Attachment>>();
			for(const { filePath, altText } of attachedMedia) {
				uploadPromisses.push(Mastodon.createMediaAttachments(filePath, altText));
			}
			uploadedMedia = await Promise.all(uploadPromisses);
		}

		const groomedText = await this.groomText(text);

		Log.info(`Posting toot for tweet id: ${tweetId}`);
		Log.info(`Groomed text:\n${groomedText}`);
		Log.info(`Attachments: ${attachedMedia?.length} ${attachedMedia?.map((media: any) => media.filePath)} ${uploadedMedia.map(media => media.id)}\n`);

		let inReplyToId;
		if(referencedTweet) {
			inReplyToId = await DBCache.getStatusId(referencedTweet);
			if(!inReplyToId) {
				Log.info(`Not posting tweet id: ${tweetId} because refrenced tweet id: ${referencedTweet} has not been posted yet or is missing`);
				return;
			} else {
				Log.info(`Posting toot for tweet id: ${tweetId} in reply to ${inReplyToId}`);
			}
		}

		const response = await this.masto.statuses.create({
			status: groomedText,
			visibility: process.env.DEBUG ? 'private' : 'public',
			mediaIds: uploadedMedia?.length > 0 ? uploadedMedia.map(media => media.id) : undefined,
			inReplyToId
		});

		if(response?.id) {
			await DBCache.updateLastTweetId(tweetId);
			await DBCache.insertStatusId(tweetId, response.id);
		}

		return response?.id;
	}

	public static async createMediaAttachments(path: string, altText: string) {
		if(fs.existsSync(path)) {
			try {
				const file = fs.createReadStream(path);

				Log.debug(`Creating media: path ${path}\n${altText}`);

				const attachment = await this.masto.mediaAttachments.create({
					file,
					description: altText ? altText : null
				});

				Log.debug(`Created attachment: ${attachment?.id}`);

				return attachment;
			} catch (error) {
				Log.error(error);
				throw `Failed to create media ${path}`;
			}
		} else {
			throw `${path} not found!`;
		}
	}
}

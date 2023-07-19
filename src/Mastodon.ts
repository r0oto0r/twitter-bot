import { login, mastodon } from 'masto';
import { Log } from './Log';
import fs from 'fs';
import config from 'config';
import moment from 'moment-timezone';
import { DBCache } from './DBCache';

export interface PreparedTweet {
	id: string;
	referencedTweet: string;
	text: string;
	attachedMedia: Array<AttachedMedia>
};

export interface AttachedMedia {
	filePath: string;
	altText?: string
};

export class Mastodon {
	private static masto: mastodon.Client;
	private static twitterHandleRegex = /(@[a-zA-Z0-9_]+)/gm;
	private static twitterMediaLinkRegex = /https:\/\/twitter\.com\/TheRocketBeans\/status\/\d*\/(video|photo)\/\d*/gm;
	private static twitterMastodonHandleMap: { [twitterHandle: string]: string };

	public static async init() {
		Log.info(`Setting up mastodon client`);

		this.twitterMastodonHandleMap = config.get('twitterMastodonHandleMap');

		this.masto = await login({
			url: config.get('mastodonBaseUrl'),
			accessToken: config.get('mastodonAccessToken')
		});

		Log.info(`Done setting up mastodon client`);
	}

	public static async groomText(text: string) {
		text = this.replaceHandles(text);
		text = this.unEntity(text);
		text = text.replaceAll(/(#\w+)/gm, '$1' + Math.floor(10000 + Math.random() * 1000));
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

	public static async updateProfile() {
		return this.masto.v1.accounts.updateCredentials({
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

	public static async createStatus(tweet: PreparedTweet) {
		const { id: tweetId, text, attachedMedia, referencedTweet } = tweet;

		const existingStatusId = await DBCache.getStatusId(tweetId);
		if(existingStatusId) {
			Log.warn(`Refusing to repost duplicated tweet for id ${tweetId}.`);
			return;
		}

		const uploadedMedia = new Array<mastodon.v1.MediaAttachment>();
		if(attachedMedia?.length > 0) {
			for(const { filePath } of attachedMedia) {
				await Mastodon.createMediaAttachments(filePath)
			}
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

		const response = await this.masto.v1.statuses.create({
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

	public static async createMediaAttachments(path: string, altText?: string) {
		if(fs.existsSync(path)) {
			try {
				const attachment = await this.masto.v2.mediaAttachments.create({
					file: new Blob([fs.readFileSync(path)]),
					description: altText
				});

				Log.debug(`Created attachment: ${attachment?.id}`);

				return attachment;
			} catch (error) {
				Log.error(error.message);
				throw `Couldn't create media attachment`;
			}
		} else {
			throw new Error(`${path} not found!`);
		}
	}
}

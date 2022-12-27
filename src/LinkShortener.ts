import { Log } from "./Log";
import axios from 'axios';
import config from "config";

export class LinkShortener {
    private static tiniURLAPIKey: string;
    private static tinyURLAPI: string;
    private static tinyURLDomain: string;

    public static async init() {
        Log.info(`Setting up link shortener`);

        this.tiniURLAPIKey = config.get("tiniURLAPIKey");
		this.tinyURLAPI = config.get("tinyURLAPI");
		this.tinyURLDomain = config.get("tinyURLDomain");

		Log.info(`Done setting up link shortener`);
    }

    public static async createShortenedLink(url: string, alias?: string) {
        try {
            let existingLink;

            if(alias) {
                existingLink = await LinkShortener.getShortenedLink(alias);
                
                if(existingLink) {
                    return existingLink;
                }
            }

            const request = {
                url,
                domain: "tiny.one",
                alias
            };

            const response = await axios.post(this.tinyURLAPI + `/create`, request, { 
                headers: { 'Authorization': `Bearer ${ this.tiniURLAPIKey}`},
            });
    
            return response?.data?.data?.tiny_url;
        } catch (error) {
            Log.warn(error?.response?.data?.errors);
        }

        return;
    }

    public static async getShortenedLink(alias: string) {
        try {
            const response = await axios.get(this.tinyURLAPI + `/alias/${this.tinyURLDomain}/${alias}`, { headers: { 'Authorization': `Bearer ${ this.tiniURLAPIKey}`} });

            return response?.data?.data?.tiny_url;;
        } catch (error) {
            Log.warn(error?.response?.data?.errors);
        }

        return;
    }
}

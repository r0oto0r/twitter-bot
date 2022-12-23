import { format, createLogger, transports } from 'winston';

const { combine, timestamp, colorize, printf } = format;
const myFormat = printf(({ level, message, timestamp }) => {
	return `${timestamp} ${level}\t${message}`;
});

export const Log = createLogger({
	transports: [
		new transports.Console({
			format: combine(
				colorize(),
				timestamp({
					format: 'DD/MM/YY-HH:mm:ssZ'
				}),
				myFormat,
			),
			level: process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info'
		})
	]
});

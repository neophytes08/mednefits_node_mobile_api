const winston = require('winston');
const { combine, prettyPrint, timestamp, colorize } = winston.format;

const logger = winston.createLogger({
	format: combine(
		timestamp(),
		prettyPrint(),
		colorize()
	),
	transports: [
		new winston.transports.Console()
	]
});


module.exports = logger;

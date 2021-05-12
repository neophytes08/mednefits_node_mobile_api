const path = require('path');
const express = require('express');
const logger = require('morgan');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const compress = require('compression');
const methodOverride = require('method-override');
const cors = require('cors');
const httpStatus = require('http-status');
const expressWinston = require('express-winston');
const expressValidation = require('express-validation');
const helmet = require('helmet');
const winstonInstance = require('./winston');
const config = require('./config');
const APIError = require('../server/helpers/APIError');
const unless = require('express-unless');
const unlessConfig = require('./unless');
const redis = require('redis');
const JWTR = require('jwt-redis').default;


const app = express();

if (config.env === 'development') {
  app.use(logger('dev'));
}

const redisClient = redis.createClient({
  host: config.redis.host, //can be IP or hostname
  port: config.redis.port, // port
  maxretries: 10, //reconnect retries, default 10
  db: 0, //optional db selection
  secret: config.jwtSecret, // secret key for Tokens!
  multiple: false, // single or multiple sessions by user
  kea: false, // Enable notify-keyspace-events KEA
});

const jwtr = new JWTR(redisClient);



// parse body params and attache them to req.body
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(cookieParser());
app.use(compress());
app.use(methodOverride());

// secure apps by setting various HTTP headers
app.use(helmet());

// enable CORS - Cross Origin Resource Sharing
app.use(cors());

// enable detailed API logging in dev env
if (config.env === 'development') {
  expressWinston.requestWhitelist.push('body');
  expressWinston.responseWhitelist.push('body');
  app.use(
    expressWinston.logger({
      winstonInstance,
      meta: true, // optional: log meta data about request (defaults to true)
      msg:
        'HTTP {{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms',
      colorStatus: true, // Color the status code (default green, 3XX cyan, 4XX yellow, 5XX red).
    })
  );
}

// authorizing with basic auth
let basicAuth = function (req, res, next) {
  var auth;
  if (req.headers.authorization)
    auth = new Buffer(req.headers.authorization.substring(6), 'base64')
      .toString()
      .split(':');

  if (
    !auth ||
    auth[0] !== config.basicAuth.username ||
    auth[1] !== config.basicAuth.password
  ) {
    const err = new APIError('Authentication error', httpStatus.UNAUTHORIZED);
    return next(err);
  } else {
    next();
  }
};
basicAuth.unless = unless;
app.use(basicAuth.unless(unlessConfig.basicAuth));

// authorizing with jwt
let jr = function (req, res, next) {
  const token = decodeURIComponent(req.headers['x-access-token']);

  // r.verify(token)
  jwtr.verify(token, config.jwtSecret)
    .then((decode) => {
      if (!decode) {
        const err = new APIError(
          'Token maybe expired',
          httpStatus.UNAUTHORIZED
        );
        return res.status(401).json({ message: 'Token maybe expired' });
      }

      req.decodedUser = decode;
      next();
    })
    .catch((err) => {
      const errs = new APIError('Token not found', httpStatus.UNAUTHORIZED);
      // return next(errs);
      return res.status(401).json({ message: 'Token not valid' });
    });
};

jr.unless = unless;
app.use(jr.unless(unlessConfig.jwt));

/** GET /health-check - Check service health */
app.get('/api/health-check', (req, res) => res.send('OK'));

// mount all routes
config.files.routes.forEach((routePath) => {
  require(path.resolve(routePath))(app);
});

// mount all policies
config.files.policies.forEach((policyPath) => {
  require(path.resolve(policyPath)).invokeRolesPolicies();
});

// if error is not an instanceOf APIError, convert it.
app.use((err, req, res, next) => {
  if (err instanceof expressValidation.ValidationError) {
    // validation error contains errors which is an array of error each containing message[]
    const unifiedErrorMessage = err.errors
      .map((error) => error.messages.join('. '))
      .join(' and ');
    const error = new APIError(unifiedErrorMessage, err.status, true);
    return next(error);
  } else if (!(err instanceof APIError)) {
    const apiError = new APIError(err.message, err.status, err.isPublic);
    return next(apiError);
  }
  return next(err);
});

// catch 404 and forward to error handler
app.use((req, res, next) => {
  const err = new APIError('API not found', httpStatus.NOT_FOUND);
  return next(err);
});

// log error in winston transports except when executing test suite
if (config.env !== 'test') {
  app.use(
    expressWinston.errorLogger({
      winstonInstance,
    })
  );
}

// error handler, send stacktrace only during development
app.use((err, req, res, next) => {
  // eslint-disable-line no-unused-vars
  res.status(err.status).json({
    message: err.isPublic ? err.message : httpStatus[err.status],
    stack: config.env === 'development' ? err.stack : {},
  });
});

module.exports = app;

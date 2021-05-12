const Joi = require('joi');
const assets = require('./assets/default.js');
const _ = require('lodash');
const glob = require('glob');

// require and configure dotenv, will load vars in .env in PROCESS.ENV
require('dotenv').config();

// define validation for all the env vars
const envVarsSchema = Joi.object({
  NODE_ENV: Joi.string()
    .allow(['development', 'production', 'test', 'provision'])
    .default('development'),
  PORT: Joi.number()
    .default(4041),
  PORTHTTPS: Joi.number()
    .default(4031),
  MONGOOSE_DEBUG: Joi.boolean()
    .when('NODE_ENV', {
      is: Joi.string().equal('development'),
      then: Joi.boolean().default(true),
      otherwise: Joi.boolean().default(false)
    }),
  JWT_SECRET: Joi.string().required()
    .description('JWT Secret required to sign'),
  MONGO_HOST: Joi.string().required()
    .description('Mongo DB url'),
  MONGO_HOST_MERCHANT: Joi.string().required()
    .description('Mongo DB merchant host url'),
  MONGO_HOST_USER: Joi.string().required()
    .description('Mongo DB user host url'),
  MONGO_PORT: Joi.number()
    .default(27017),
  APPS_USERNAME: Joi.string().required()
    .description('Username is required for basic auth'),
  APPS_PASSWORD: Joi.string().required()
    .description('Password is required for basic auth'),
  FIREBASE_HOST: Joi.string().required()
    .description('Firebase host is required'),
  FIREBASE_KEY: Joi.string().required()
    .description('Firebase key is required'),
  MIDTRANS_API: Joi.string().required()
    .description('Midtrans API Address is required'),
  MIDTRANS_API_CLIENT_KEY: Joi.string().required()
    .description('Midtrans API Client Key is required'),
  MIDTRANS_API_SERVER_KEY: Joi.string().required()
    .description('Midtrans API Server Key is required'),
  SMTP_HOST: Joi.string().required()
    .description('SMTP host is required'),
  SMTP_PORT: Joi.string().required()
    .description('SMTP Port is required'),
  SMTP_USER: Joi.string().required()
    .description('SMTP user is required'),
  SMTP_PASSWORD: Joi.string().required()
    .description('SMTP password is required'),
  XENDIT_API: Joi.string().required()
    .description('Xendit API Address is required'),
  XENDIT_KEY_SECRET: Joi.string().required()
    .description('Xendit secret key is required'),
  XENDIT_KEY_PUBLIC: Joi.string().required()
    .description('Xendit public key is required'),
  XENDIT_KEY_CALLBACK: Joi.string().required()
    .description('Xendit callback key is required'),
  INTERNAL_ADDRESS: Joi.string().required()
    .description('internal address is required')
}).unknown()
  .required();

const { error, value: envVars } = Joi.validate(process.env, envVarsSchema);
if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}


/**
 * Get files by glob patterns
 */
const getGlobbedPaths = function (globPatterns, excludes) {
  // URL paths regex
  const urlRegex = new RegExp('^(?:[a-z]+:)?\/\/', 'i');

  // The output array
  let output = [];

  // If glob pattern is array then we use each pattern in a recursive way, otherwise we use glob
  if (_.isArray(globPatterns)) {
    globPatterns.forEach(function (globPattern) {
      output = _.union(output, getGlobbedPaths(globPattern, excludes));
    });
  } else if (_.isString(globPatterns)) {
    if (urlRegex.test(globPatterns)) {
      output.push(globPatterns);
    } else {
      let files = glob.sync(globPatterns);
      if (excludes) {
        files = files.map(function (file) {
          if (_.isArray(excludes)) {
            for (let i in excludes) {
              file = file.replace(excludes[i], '');
            }
          } else {
            file = file.replace(excludes, '');
          }
          return file;
        });
      }
      output = _.union(output, files);
    }
  }

  return output;
};

const config = {
  files: {
    routes: getGlobbedPaths(assets.routes),
    policies: getGlobbedPaths(assets.policies)
  },
  env: envVars.NODE_ENV,
  port: {
    http: envVars.PORT,
    https: envVars.PORTHTTPS
  },
  mongooseDebug: envVars.MONGOOSE_DEBUG,
  jwtSecret: envVars.JWT_SECRET,
  mongo: {
    host: envVars.MONGO_HOST,
    merchant_host: envVars.MONGO_HOST_MERCHANT,
    user_host: envVars.MONGO_HOST_USER,
    port: envVars.MONGO_PORT
  },
  basicAuth: {
    username: envVars.APPS_USERNAME,
    password: envVars.APPS_PASSWORD
  },
  firebase: {
    host: envVars.FIREBASE_HOST,
    key: envVars.FIREBASE_KEY
  },
  midtrans: {
    address: envVars.MIDTRANS_API,
    client_key: envVars.MIDTRANS_API_CLIENT_KEY,
    server_key: envVars.MIDTRANS_API_SERVER_KEY
  },
  smtp: {
    host: envVars.SMTP_HOST,
    port: envVars.SMTP_PORT,
    user: envVars.SMTP_USER,
    password: envVars.SMTP_PASSWORD
  },
  xendit: {
    address: envVars.XENDIT_API,
    secret_key: envVars.XENDIT_KEY_SECRET,
    public_key: envVars.XENDIT_KEY_PUBLIC,
    callback_key: envVars.XENDIT_KEY_CALLBACK
  },
  redis: {
    host: envVars.REDIS_HOST,
    port: envVars.REDIS_PORT
  },
  internalAddress: envVars.INTERNAL_ADDRESS
};


module.exports = config;

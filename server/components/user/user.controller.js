const User = require('./user.model');
const httpStatus = require('http-status');
const APIError = require('../../helpers/APIError');
const config = require('../../../config/config');
const speakeasy = require('speakeasy');
const moment = require('moment');
const _ = require('lodash');
const { callbackMakerAdv, broadcaster } = require('../../helpers/functions');


/**
 * Get Payment OTP
 */
async function getPaymentOTP(req, res, next){
  const user = req.decodedUser.dataToken;
  let tokens = OTPCreator();

  let userDetail = await User.findById(user._id);

  if(!userDetail) return next(new APIError('User not found!', httpStatus.NOT_FOUND, true));

  await User.findByIdAndUpdate(user._id, {
    paymentOTP: {
      secret: tokens.secret.base32,
      encoding: tokens.encoding,
      step: tokens.delay,
      digits: tokens.digits,
      window: 0
      // timestamp: tokens.timestamps,
    }
  });

  return res.json({
    token: tokens.otp,
    expired: tokens.timestamps
  });
}

/**
 *  Validate OTP
 */
async function validateOTP(req, res, next){
  const user = req.decodedUser.dataToken;
  const userDetail = await User.findById(user._id).select('paymentOTP');

  if(!userDetail) return next(new APIError('User not found!', httpStatus.NOT_FOUND, true));

  const token = speakeasy.totp.verify({
    token: req.body.token,
    secret: userDetail.paymentOTP.secret,
    encoding: userDetail.paymentOTP.encoding,
    step: userDetail.paymentOTP.step,
    digits: userDetail.paymentOTP.digits,
    window: 0
    // time: userDetail.paymentOTP.timestamp
  });

  return res.json({
    valid: token
  })
}

async function testing(req, res, next){
  // const a = await requester({
  //  // timeout: 1500,
  //  uri: 'http://127.0.0.1:4041/api/pgchecker',
  //  method: 'GET',
  //  json: {
  //    provider: 'xendit'
  //  }
  // });

  // return res.json(a);
  
  const a = HelperFunctions.callbackMakerAdv('TESTIS.123123', {}, 214234);
  console.log(`################# ${JSON.stringify(a)}`);
  await broadcaster('finishTransaction', '087881682396', true, a);

  return res.json({message: 'done'});
}


/**
 *  Helper functions
 */
function OTPCreator(){
  const mTime = timeCreator();
  let secret = speakeasy.generateSecret();
  let token = speakeasy.totp({
    secret: secret.base32,
    encoding: 'base32',
    step: mTime.delay,
    digits: 4,
    window: 0
    // time: mTime.time,
    // delay: mTime.delay
  });

  return {
    secret: secret,
    otp: token,
    encoding: 'base32',
    timestamps: mTime.time,
    delay: mTime.delay,
    digits: 4
  };
}

function timeCreator(){
  const delay = 30;
  const start = moment();
  // const remainder = delay - (start.second() % delay);
  
  return {
    // time: moment(start).add(remainder, "seconds").valueOf(),
    // time: moment(start).add(30, "seconds").valueOf(),
    delay: delay
  }
}



module.exports = { 
  getPaymentOTP,
  validateOTP,
  testing
};
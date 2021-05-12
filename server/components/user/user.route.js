const validate = require('express-validation');
const paramValidation = require('./user.validation');
const userCtrl = require('./user.controller');


/**
 * Module dependencies
 */
module.exports =  app => {
  app.route('/api/users/paymentotp')
	/** GET /api/users/paymentotp - To get payment OTP */
	.get(userCtrl.getPaymentOTP)

	/** POST /api/users/paymentotp - To validate payment OTP (TESTING) */
  	.post(userCtrl.validateOTP);

  app.route('/api/users/testing')
  	/** Testing purpose */
  	.get(userCtrl.testing);

  /** Load user when API with userId route parameter is hit */
  // app.param('userId', userCtrl.load);
};
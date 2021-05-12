const path = require('path');
const validate = require('express-validation');
const paramValidation = require('./auth.validation');
const authCtrl = require('./auth.controller');

/**
 * Module dependencies
 */
module.exports =  app => {
  app.route('/api/auth/random-number')
    .get(authCtrl.getRandomNumber);
};

// async await handlers is express.js
require('express-async-errors');

const path = require('path');
const httpStatus = require('http-status');
const APIError = require(path.resolve('./server/helpers/APIError'));
const config = require(path.resolve('./config/config'));


/**
 * Returns jwt token if valid identity and password is provided
 * @property {string} req.body.identity - The identity of the user, can be filled with email or nric
 * @property {string} req.body.password - The password of the user
 * @returns {token String, active Number}
 */


/**
 * This is a protected route. Will return random number only if jwt token is provided in header.
 * @param req
 * @param res
 * @returns {*}
 */
function getRandomNumber(req, res) {
  // req.user is assigned by jwt middleware if valid token is provided
  return res.json({
    // user: req.user,
    num: Math.random() * 100,
  });
}

module.exports = {
  getRandomNumber
};
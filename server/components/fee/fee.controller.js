// async await handlers is express.js
require('express-async-errors');

const Fee = require('./fee.model');
const config = require('../../../config/config');



String.prototype.equals = function(that) {
    return this === that;
}

/**
 * Load fee and append to req.
 */
async function load(req, res, next, id) {
  req.fees = await Fee.get(id); // eslint-disable-line no-param-reassign
  return next();
}

/**
 * Get fee
 * @returns {Fee}
 */
function get(req, res) {
  return res.json(req.fees);
}

/**
 * Get fee list.
 * @property {number} req.query.skip - Number of fees to be skipped.
 * @property {number} req.query.limit - Limit number of fees to be returned.
 * @returns {Fee[]}
 */
async function list(req, res, next) {
  const { limit = 50, skip = 0 } = req.query;
  const type = req.query.type;

  res.json(await Fee.findOne({type: type}));
}


module.exports = { 
  load,
  get,
  list
};
const Promise = require('bluebird');
const mongoose = require('mongoose');
const httpStatus = require('http-status');
const config = require('../../../config/config');
const APIError = require('../../helpers/APIError');




/**
 * Mobile Asset Schema
 */
const TransactionLogSchema = new mongoose.Schema({
  transactionNumber: {
    type: String
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  store: {
    type: mongoose.Schema.ObjectId,
    ref: 'Store'
    // type: String
  },
  total: Number,
  status_code: String,
  detail: {}
}, { timestamps: true, runSettersOnQuery: true });


/**
 * Add your
 * - pre-save hooks
 * - validations
 * - virtuals
 */

/**
 * Methods
 */
// TransactionLogSchema.method({
// });


/**
 * Post save function. so we can determine user's termin
 */
// TransactionLogSchema.pre('save', function(next){
// });



/**
 * Statics
 */
TransactionLogSchema.statics = {
  /**
   * Get transactionLog
   * @param {ObjectId} id - The objectId of transactionLog.
   * @returns {Promise<TransactionLog, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((transactionLog) => {
        if (transactionLog) {
          return transactionLog;
        }
        const err = new APIError('No such transactionLog exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List transactionLogs in descending order of 'createdAt' timestamp.
   * @param {number} skip - Number of templates to be skipped.
   * @param {number} limit - Limit number of templates to be returned.
   * @returns {Promise<UserSalary[]>}
   */
  list({ skip = 0, limit = 50 } = {}) {
    return this.find()
      .sort({ createdAt: -1 })
      .skip(+skip)
      .limit(+limit)
      .exec();
  }
};



/**
 * @typedef User Salary
 */
module.exports = mongoose.connection.useDb(config.mongo.user_host).model('TransactionLog', TransactionLogSchema);

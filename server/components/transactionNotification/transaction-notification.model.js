const Promise = require('bluebird');
const mongoose = require('mongoose');
const httpStatus = require('http-status');
const APIError = require('../../helpers/APIError');
const config = require('../../../config/config');


/**
 * Transaction Notification Schema
 */
const TransactionNotificationSchema = new mongoose.Schema({
  // approvedTransactionId: {
  //   type: mongoose.Schema.ObjectId,
  //   ref: 'ApprovedTransaction',
  //   required: true,
  //   unique: 'Please provide an unique transaction id'
  // },
  // preApprovedTransactionId: {
  //   type: mongoose.Schema.ObjectId,
  //   ref: 'PreApprovedTransaction',
  //   required: true,
  //   unique: 'Please provide an unique transaction id'
  // },
  transactionNumber: {
    type: String,
    required: true,
    unique: 'Please provide an unique transaction number'
  },
  merchantEmail: {
    sent: {
      type: Boolean,
      default: false
    },
    detail: {}
  },
  userEmail: {
    sent: {
      type: Boolean,
      default: false
    },
    // detail: {}
    detail: []
  },
  merchantCallback: {
    sent: {
      type: Boolean,
      default: false
    },
    detail: {},
    response: []
  },
  userPushNotif: {
    sent: {
      type: Boolean,
      default: false
    },
    detail: {}
  }
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
TransactionNotificationSchema.method({
});



/**
 * Statics
 */
TransactionNotificationSchema.statics = {
  /**
   * Get Transaction Notification
   * @param {ObjectId} id - The objectId of transaction.
   * @returns {Promise<Transaction, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((transaction) => {
        if (transaction) {
          return transaction;
        }
        const err = new APIError('No such transaction notification exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List Transaction Notifications in descending order of 'createdAt' timestamp.
   * @param {number} skip - Number of transactions to be skipped.
   * @param {number} limit - Limit number of transactions to be returned.
   * @returns {Promise<Transaction[]>}
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
 * @typedef Transaction
 */
module.exports = mongoose.connection.useDb(config.mongo.user_host).model('TransactionNotification', TransactionNotificationSchema);

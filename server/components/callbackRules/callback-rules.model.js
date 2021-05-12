const mongoose = require('mongoose');
const config = require('../../../config/config');



/**
 * User Schema
 */
const CallbackRulesSchema = new mongoose.Schema({
  transactionNumber: {
    type: String,
    required: 'transactionNumber is required'
  },
  override: {
    type: Boolean,
    default: false
  },
  store: {
    type: mongoose.Schema.ObjectId,
    required: 'Please fill in store id',
    ref: 'Store'
  },
  uris: [{
    type: String
  }]
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
CallbackRulesSchema.method({
});


/**
 * Statics
 */
CallbackRulesSchema.statics = {
  /**
   * Get callbackRules
   * @param {ObjectId} id - The objectId of callbackRules.
   * @returns {Promise<CallbackRules, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((callbackRules) => {
        if (callbackRules) {
          return callbackRules;
        }
        const err = new APIError('No such callbackRules exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  }
};

/**
 * @typedef CallbackRules
 */
module.exports = mongoose.connection.useDb(config.mongo.merchant_host).model('CallbackRules', CallbackRulesSchema);
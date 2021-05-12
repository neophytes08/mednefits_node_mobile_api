const Promise = require('bluebird');
const mongoose = require('mongoose');
const httpStatus = require('http-status');
const config = require('../../../config/config');
const APIError = require('../../helpers/APIError');



/**
 * User Salary Schema
 */
const FeeSchema = new mongoose.Schema({
  type: {
    type: String,
    unique: 'Type already used, please choose another one',
    required: 'Please fill salary\'s type',
    // lowercase: true,
    trim: true
  },
  description: {
  	type: String,
  	required: 'Please fill salary\'s description'
  },
  amount: {
    type: Number,
    required: 'Please fill an amount to be assigned'
  },
  admin: {
  	type: mongoose.Schema.ObjectId,
    ref: 'Admin'
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
// FeeSchema.method({
// });


/**
 * Post save function. so we can determine user's termin
 */
// FeeSchema.pre('save', function(next){
// });



/**
 * Statics
 */
FeeSchema.statics = {
  /**
   * Get user salary
   * @param {ObjectId} id - The objectId of user salary.
   * @returns {Promise<Fee, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((fee) => {
        if (fee) {
          return fee;
        }
        const err = new APIError('No such user salary exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List fees in descending order of 'createdAt' timestamp.
   * @param {number} skip - Number of templates to be skipped.
   * @param {number} limit - Limit number of templates to be returned.
   * @returns {Promise<Fee[]>}
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
module.exports = mongoose.connection.useDb(config.mongo.user_host).model('Fee', FeeSchema);
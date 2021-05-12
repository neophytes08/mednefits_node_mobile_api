const Promise = require('bluebird');
const mongoose = require('mongoose');
const httpStatus = require('http-status');
const APIError = require('../../helpers/APIError');
const crypto = require('crypto');
const validator = require('validator');
const owasp = require('owasp-password-strength-test');
const generatePassword = require('generate-password');
const Merchant = require('../merchant/merchant.model');
const config = require('../../../config/config');
const util = require('util');



/**
 * User Schema
 */
const StoreSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    default: ''
  },
  username: {
    type: String,
    unique: 'Username already exists',
    required: 'Please fill in a username',
    trim: true
  },
  merchant: {
    type: mongoose.Schema.ObjectId,
    required: 'Please fill in merchant id',
    ref: 'Merchant'
  },
  image: {
    type: String
  },
  loc: {
    type: {
      type: String,
      default: 'Point'
    },
    coordinates: [Number] // [latitude, longitude]
  },
  website: {
    type: String
  },
  mobileNumber: {
    type: String,
    required: 'Please fill in a mobile number'
  },
  title: {
    type: String
  },
  salt: {
    type: String
  },
  password: {
    type: String,
    required: 'Merchant password is required'
  },
  email: {
    type: String,
    index: true,
    match: /.+\@.+\..+/
  },
  callback: {
    type: String
  },
  active: {
    type: Boolean,
    default: true
  },
  online: {
    type: Boolean,
    required: true,
    default: false
  },
  category: {
    type: mongoose.Schema.ObjectId,
    ref: 'StoreCategory',
    type: Array
  },
  transactionExpirationDuration: {
    type: Number,
    default: 120
  },
  /* For reset password */
  resetPasswordToken: {
    type: String
  },
  resetPasswordExpires: {
    type: Date
  },
  defaultTerminDuration: {
    type: Number,
    default: 14
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
StoreSchema.method({
});


/**
 * Create index for geolocation
 **/
StoreSchema.index({'loc': '2dsphere'});




/**
 * Statics
 */
StoreSchema.statics = {
  /**
   * Get store
   * @param {ObjectId} id - The objectId of store.
   * @returns {Promise<Store, APIError>}
   */
  get(id) {
    return this.findById(id)
      .populate('merchant', 'convenienceFee', Merchant)
      .exec()
      .then((store) => {
        if (store) {
          return store;
        }
        const err = new APIError('No such store exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List stores in descending order of 'createdAt' timestamp.
   * @param {number} skip - Number of stores to be skipped.
   * @param {number} limit - Limit number of stores to be returned.
   * @returns {Promise<Store[]>}
   */
  list({ skip = 0, limit = 50, merchant = '', status = [true, false] } = {}) {
    if(merchant !== ''){
      return this.find({
        merchant: merchant,
        active: {
          $in: status
        }
      })
        .select('name username image loc website mobileNumber title email active merchant online transactionExpirationDuration')
        .sort({ createdAt: -1 })
        .skip(+skip)
        .limit(+limit)
        .exec();
    } else{
      return this.find({
        active: {
          $in: status
        }
      })
        .select('name username image loc website mobileNumber title email active online transactionExpirationDuration')
        .sort({ createdAt: -1 })
        .skip(+skip)
        .limit(+limit)
        .exec();
    }

  }
};

/**
 * @typedef Store
 */
module.exports = mongoose.connection.useDb(config.mongo.merchant_host).model('Store', StoreSchema);

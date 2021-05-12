const Promise = require('bluebird');
const mongoose = require('mongoose');
const config = require('../../../config/config');
const APIError = require('../../helpers/APIError');


/**
 * Voucher Schema
 */
const VoucherSchema = new mongoose.Schema({
  code: {
    type: String,
    unique: 'Voucher code already exists',
    required: 'Please fill in deduct type'
  },
  deduct: {
    type: {
      type: String,
      enum: ['fix', 'percentage'],
      required: 'Please fill in deduct type',
      default: 'fix'
    },
    total: {
      type: Number,
      default: 0,
      required: 'Please fill in discount amount'
    },
    maximum: {
      type: Number,
      default: 0
    }
  },
  description: {
    type: String
  },
  start: {
    type: Date
  },
  expired: {
    type: Date
  },
  used: {
    type: Boolean,
    default: false
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  type: {
    type: String,
    enum: ['private', 'general', 'automatic'],
    required: 'Please fill in discount type',
    default: 'fix'
  },
  quota: {
    type: Number,
    default: 0
  },
  remainingQuota: {
    type: Number,
    default: 0
  },
  affecting: {
    termin: {
      type: Boolean,
      required: 'Please fill voucher affecting type',
      default: true
    },
    terminNumber: {
      type: [Number],
      enum: [2, 3, 4],
      default: [4],
      required: 'Please fill in '
    }
  },
  merchants: {
    type: [mongoose.Schema.ObjectId],
    ref: 'Merchant'
  },
  terms: {
    onlyCanBeUsedOncePerUser: {
      type: Boolean,
      required: 'Please fill onlyCanBeUsedOncePerUser',
      default: false
    }
  },
  minimumTransaction: {
    type: Number,
    required: 'Please fill in minimum transaction for using this voucher',
    default: 0
  },
  transactionTime: {
    start: {
      type: Date
    },
    end: {
      type: Date
    }
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
// VoucherSchema.method({
// });


/**
 * Post save function. so we can determine user's termin
 */
// VoucherSchema.pre('save', function(next){
// });



/**
 * Statics
 */
VoucherSchema.statics = {
  /**
   * Get user salary
   * @param {ObjectId} id - The objectId of user salary.
   * @returns {Promise<Voucher, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((voucher) => {
        if (voucher) {
          return voucher;
        }
        const err = new APIError('No such voucher exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List vouchers in descending order of 'createdAt' timestamp.
   * @param {number} skip - Number of templates to be skipped.
   * @param {number} limit - Limit number of templates to be returned.
   * @returns {Promise<Voucher[]>}
   */
  list({ skip = 0, limit = 50, user = '' } = {}) {
    return this.find({ $or: [{user: user}, {type: 'general'}]})
      .sort({ createdAt: 1 })
      .skip(+skip)
      .limit(+limit)
      .exec();
  }
};



/**
 * @typedef User Salary
 */
module.exports = mongoose.connection.useDb(config.mongo.user_host).model('Voucher', VoucherSchema);

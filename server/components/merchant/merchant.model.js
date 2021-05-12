const Promise = require('bluebird');
const mongoose = require('mongoose');
const httpStatus = require('http-status');
const APIError = require('../../helpers/APIError');
const config = require('../../../config/config');



/**
 * User Schema
 */
const MerchantSchema = new mongoose.Schema({
  username: {
    type: String,
    unique: 'Username already exists',
    required: 'Please fill in a username',
    trim: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true,
    default: ''
  },
  mobileNumber: {
    type: String,
    unique: 'Mobile number already exists',
    required: 'Please fill in a mobile number'
  },
  salt: {
    type: String
  },
  password: {
    type: String,
    required: 'Merchant password is required'
  },
  image: {
    type: String
  },
  title: {
    type: String
  },
  fImage: {
    type: String
  },
  website: {
    type: String
  },
  activated: {
    type: Boolean,
    required: true,
    default: false
  },
  bank: {
    number: {
      type: String
    },
    name: {
      type: String
    },
    holder: {
      type: String
    }
  },
  pic: {
    name: {
      type: String
    },
    certNumber: {
      type: String
    },
    address: {
      type: String
    }
  },
  /* For reset password */
  resetPasswordToken: {
    type: String
  },
  resetPasswordExpires: {
    type: Date
  },
  // convenienceFee: {
  //   type: Number,
  //   required: 'Please provide convenience fee',
  //   default: 10000
  // },
  convenienceFee: {
    twoWeekly: {
      type: Number,
      required: 'Please provide 14 days convenience fee',
      default: 0
    },
    monthly: {
      type: Number,
      required: 'Please provide 30 days convenience fee',
      default: 20000
    }
  },
  zilingo: {
    type: Boolean,
    default: false,
    required: true
  },
  prefix: {
    type: String
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
MerchantSchema.method({
});


/**
 * Statics
 */
MerchantSchema.statics = {
  /**
   * Get merchant
   * @param {ObjectId} id - The objectId of merchant.
   * @returns {Promise<Merchant, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((merchant) => {
        if (merchant) {
          return merchant;
        }
        const err = new APIError('No such merchant exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * Get merchant based on location
   */
  // getListFromLocation({ skip = 0, limit = 50 } = {}, loc){
  //   return this.find({
  //     loc: {
  //       $nearSphere: {
  //         $geometry: {
  //           type : "Point",
  //           coordinates : loc
  //         },
  //         $minDistance: 10,
  //         $maxDistance: 1000
  //       }
  //     }
  //   })
  //     .sort({ createdAt: -1 })
  //     .skip(+skip)
  //     .limit(+limit)
  //     .exec();
  // },


  /**
   * List merchants in descending order of 'createdAt' timestamp.
   * @param {number} skip - Number of merchants to be skipped.
   * @param {number} limit - Limit number of merchants to be returned.
   * @returns {Promise<Merchant[]>}
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
 * @typedef Merchant
 */
module.exports = mongoose.connection.useDb(config.mongo.merchant_host).model('Merchant', MerchantSchema);

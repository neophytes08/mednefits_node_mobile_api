const mongoose = require('mongoose');
const httpStatus = require('http-status');
const config = require('../../../config/config');
const APIError = require('../../helpers/APIError');



/**
 * User Schema
 *
 * We got some status here for the users
 * 0 -> user just registered to empatkali
 * 1 -> user already fill all the field form but waiting for approval empatkali
 * 2 -> user already approve and can doing all transaction
 * 3 -> user banned
 * 4 -> rejected
 * 5 -> freeze (late pay)
 */
const UserSchema = new mongoose.Schema({
  mobileNumber: {
    type: String,
    unique: 'Mobile number already exists',
    required: 'Please fill in a mobile number',
    // match: [/^[0-9][0-9]{10,13}$/, 'The value of path {PATH} ({VALUE}) is not a valid mobile number.']
    // match: [/^08\d[0-9]{7,9}$/g, 'The value of path {PATH} ({VALUE}) is not a valid mobile number.']
  },
  regId: {
    type: String,
    required: 'Please fill in a registration id',
  },
  credit: {
    type: Number,
    default: 0
  },
  // creditRequestStatus: {
  //   status: {
  //     type: Number
  //   }
  // },
  ktp: {
    number: {
      type: String
    },
    image: {
      type: String
      // default: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png'
      // match: [/^((https?|ftp|smtp):\/\/)?(www.)?[a-z0-9]+(\.[a-z]{2,}){1,3}(#?\/?[a-zA-Z0-9#]+)*\/?(\?[a-zA-Z0-9-_]+=[a-zA-Z0-9-%]+&?)?$/, 'The value of path {PATH} ({VALUE}) is not a valid url.']
    },
    status: {
      type: Number
    }
  },
  slip: {
    image: {
      type: String
    },
    status: {
      type: Number
    }
  },
  selfie: {
    type: String
    // default: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png'
    // match: [/^((https?|ftp|smtp):\/\/)?(www.)?[a-z0-9]+(\.[a-z]{2,}){1,3}(#?\/?[a-zA-Z0-9#]+)*\/?(\?[a-zA-Z0-9-_]+=[a-zA-Z0-9-%]+&?)?$/, 'The value of path {PATH} ({VALUE}) is not a valid url.']
  },
  profilePicture: {
    type: String
    // default: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png'
  },
  npwp: {
    type: String
  },
  npwpImage: {
    type: String
  },
  activated: {
    type: Boolean,
    default: false
  },
  firebase: {
    type: String
  },
  remainingCredit: {
    type: Number,
    default: 0
  },
  status: {
    type: Number,
    required: true,
    default: 0
  },
  detail: {
    address: {
      type: String
    },
    email: {
      type: String, 
      index: true,
      sparse: true,
      trim: true,
      match: /.+\@.+\..+/
    },
    name: {
      type: String
    },
    birthplace: {
      type: String
    }, 
    birthdate: {
      type: Date
    },
    industri: {
      type: String
    },
    pekerjaan: {
      type: String
    },
    pendidikan: {
      type: String
    },
    penghasilan: {
      type: String
    },
    gender: {
      type: String,
      enum : ['f', 'm'],
      lowercase: true,
      trim: true
    }
  },
  emergencyContact: {
    mobileNumber: {
      type: String
    },
    name: {
      type: String
    },
    type: {
      type: String
    }
  },
  card: [{
    alias: {
      type: String
    },
    token: {
      type: String
    },
    masked: {
      type: String
    },
    bank: {
      type: String
    },
    type: {
      type: String
    },
    defaultCard: {
      type: Boolean,
      default: false
    },
    holder: {
      type: String
    },
    paymentGateway: {
      type: String,
      enum: ['midtrans', 'xendit']
    }
  }],
  surveyPreferences: {
    type: String
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  // callLogs: [
    // {
    //   callNumber: String,
    //   type: String,
    //   date: Date,
    //   duration: Number
    // }
  // ],
  otp: {
    secret: {
      type: String
    },
    digits: {
      type: Number
    },
    encoding: {
      type: String
    },
    window: {
      type: Number
    },
    tried: {
      type: Number,
      default: 0,
      required: true
    },
    firstAttempt: {
      type: Boolean,
      default: false,
      required: true
    },
    timestamp: Number,
    epoch: Number
  },
  sentOtp: {
    isSent: {
      type: Boolean,
      default: false
    },
    exp: {
      type: Date
    }
  },
  emailVerificationOtp: {
    secret: {
      type: String
    },
    digits: {
      type: Number,
      default: 6
    },
    encoding: {
      type: String
    },
    sent: {
      type: Boolean,
      default: false
    },
    timestamp: Number,
    epoch: Number
  },
  verificator: {
    secret: {
      type: String
    },
    digits: {
      type: String
    },
    encoding: {
      type: String
    },
    window: {
      type: Number
    }
  },
  ktpNpwpPassed: {
    type: Boolean,
    required: true,
    default: false
  },
  loc: {
    type: {
      type: String,
      default: 'Point'
    },
    coordinates: [Number] // [latitude, longitude]
  },
  testingAccount: {
    type: Boolean,
    default: false
  },
  defaultPayment: {
    type: String,
    // required: 'Please fill in user\'s default payment',
    enum: ['dana', 'card', 'gopay']
  },
  danaVerifiedAccount: {
    type: Boolean,
    default: false,
    required: true
  },
  gopayVerifiedAccount: {
    type: Boolean,
    default: false,
    required: true
  },
  registrationLoc: {
    type: {
      type: String,
      default: 'Point'
    },
    coordinates: [Number] // [latitude, longitude]
  },
  phoneData: [{
    imei: [{
      type: String
    }],
    brand: {
      type: String
    },
    model: {
      type: String
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  referralCode: {
    type: String,
    unique: 'Please provide an unique code',
    // required: true,
    // default: () => {
    //  let result           = '';
    //  const characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    //  const charactersLength = characters.length;
    //  for ( var i = 0; i < 7; i++ ) {
    //     result += characters.charAt(Math.floor(Math.random() * charactersLength));
    //  }
    //  return result;
    // }
  },
  referrer: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  paymentOTP: {
    secret: {
      type: String
    },
    digits: {
      type: Number
    },
    encoding: {
      type: String
    },
    window: {
      type: Number
    },
    // tried: {
    //   type: Number,
    //   default: 0,
    //   required: true
    // },
    // firstAttempt: {
    //   type: Boolean,
    //   default: false,
    //   required: true
    // },
    timestamp: Number,
    epoch: Number,
    step: Number
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
UserSchema.method({
});

/**
 * Statics
 */
UserSchema.statics = {
  /**
   * Get user
   * @param {ObjectId} id - The objectId of user.
   * @returns {Promise<User, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((user) => {
        if (user) {
          return user;
        }
        const err = new APIError('No such user exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List users in descending order of 'createdAt' timestamp.
   * @param {number} skip - Number of users to be skipped.
   * @param {number} limit - Limit number of users to be returned.
   * @returns {Promise<User[]>}
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
 * @typedef User
 */
module.exports = mongoose.connection.useDb(config.mongo.user_host).model('User', UserSchema);
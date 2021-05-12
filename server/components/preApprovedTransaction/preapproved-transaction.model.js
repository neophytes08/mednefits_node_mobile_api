const Promise = require('bluebird');
const mongoose = require('mongoose');
const httpStatus = require('http-status');
const APIError = require('../../helpers/APIError');
const config = require('../../../config/config');
const util = require('util');


Date.prototype.addHours = function(h) {
  this.setTime(this.getTime() + (h*60*60*1000));
  return this;
}

Date.prototype.addDays = function(d) {
  this.setDate(this.getDate() + Number(d));
  return this;
}

Date.prototype.addSeconds = function(s) {
  this.setSeconds(this.getSeconds() + s);
  return this;
}

/**
 * PreApprovedTransaction Schema
 *
 * We got some status here for the transactions
 * 0 -> transaction just created
 * 1 -> transaction has been verified (with token process) and the first payment already paid. The status is in installment process
 * 2 -> Finish / paid off
 * 3 -> transaction is in problem
 *
 * For transaction number will be formatted like this:
 * merchant.name+Date.now()
 *
 * For payment things, we will use format like:
 * type-transaction_number-termins.number
 * where termins.number is optional. We will not using termins-number in initial charge / insert card
 * where type stands for the type of payment. below is the payment type:
 * 1. initial
 * 2. payment
 */
const PreApprovedTransactionSchema = new mongoose.Schema({
  orderId: {
    type: String
  },
  transactionNumber: {
    type: String,
    required: true,
    unique: 'Please provide an unique transaction number'
  },
  total: Number,
  pending: {
    type: Boolean,
    required: true,
    default: true
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
  customFields: {},
  status: {
    type: Number,
    required: true,
    default: 0,
    enum: [0, 1, 2]
  },
  cardToken: {
    type: String
  },
  paymentType: {
    type: String,
    required: 'Payment type must be filled',
    enum: ['card', 'dana', 'gopay'],
    default: 'card'
  },
  pgResponse: {},
  statusCode: {
    code: String
  },
  platform: {
    type: String,
    enum: ['shopify', 'other'],
    default: 'other'
  },
  callback: {},
  redirectURL: {
    type: String
  },
  property: {},
  terminDuration: {
    type: Number,
    enum: [14, 30],
    default: 14,
    required: 'Please provide termin duration'
  },
  zilingo: {
    is: {
      type: Boolean,
      default: false,
      required: true
    },
    code: {
      type: String
    },
    expire: {
      type: String
    }
  },
  failedURL: {
    type: String
  },
  cancelNotification: {
    payload: {},
    lastSent: {
      type: Date
    },
    sent: {
      type: Boolean,
      default: false
    },
    detail: {},
    response: []
  },
  reminder: {
    name: {
      type: String
    },
    email: {
      type: String
    },
    sent: {
      type: Boolean,
      required: true,
      default: false
    },
    time: {
      type: Date
    }
  },
  otherFields: {},
  transactionBucket: {}
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
PreApprovedTransactionSchema.method({
});




/**
 * Statics
 */
PreApprovedTransactionSchema.statics = {
  /**
   * Get preApprovedTransaction
   * @param {ObjectId} id - The objectId of transaction.
   * @returns {Promise<Transaction, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((preApprovedTransaction) => {
        if (preApprovedTransaction) {
          return preApprovedTransaction;
        }
        const err = new APIError('No such pre approved transaction exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List preApprovedTransactions in descending order of 'createdAt' timestamp.
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
  },


  /**
   * Update termin with payment data.
   * @param {ObjectId} tid - The objectId of transaction
   * @param {ObjectId} pid - The objectId of termin
   * @returns {Promise<PreApprovedTransaction[]>}
   */
   checkPayment(tid, pid) {
     return this.findById(tid)
      .exec()
      .then(preApprovedTransaction => {
        if(!preApprovedTransaction){
          const err = new APIError('No such pre approved transaction exists!', httpStatus.NOT_FOUND);
          return Promise.reject(err);
        }

        // checking payment status
        let isPaid = false;
        for(let i=0;i<preApprovedTransaction.termins.length;i++){
          if((preApprovedTransaction.termins[i].paid._id === pid) && preApprovedTransaction.termins[i].paid.status){
            isPaid = true;
          }
        }

        if(isPaid){
          const err = new APIError(`Payment with id ${pid} is already paid!`, httpStatus.NOT_FOUND);
          return Promise.reject(err);
        } else{
          return preApprovedTransaction;
        }
      })
    },

  /**
   * Updating pin
   * @param {ObjectId} - The objectId of pre approved transaction transcation
   * @returns {Promise<PreApprovedTransaction[]>}
   */
  async updatePIN(tid){
    return this.findById(tid)
      .exec()
      .then(preApprovedTransaction => {
        if(!preApprovedTransaction){
          const err = new APIError('No such pre approved transaction exists!', httpStatus.NOT_FOUND);
          return Promise.reject(err);
        }

        preApprovedTransaction.otp.number = otpCreator();
        preApprovedTransaction.otp.expired = new Date().addSeconds(30);

        preApprovedTransaction.save((err) => {
          if(err) throw err;

          return preApprovedTransaction;
        });
      });
  }
};



/**
 *  Helper function
 */
let minuteFromNow = function(){
    let pureTime = new Date();
    let timeObject = new Date();
    timeObject.setTime(timeObject.getTime() + 1000 * 60);

    return {
      pure: pureTime,
      added: timeObject
    }
};

let otpCreator = () =>{
  return Math.floor(100000 + Math.random() * 900000);
};



/**
 * @typedef PreApprovedTransaction
 */
module.exports = mongoose.connection.useDb(config.mongo.user_host).model('PreApprovedTransaction', PreApprovedTransactionSchema);

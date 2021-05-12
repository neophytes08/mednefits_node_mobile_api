const Promise = require('bluebird');
const mongoose = require('mongoose');
const moment = require('moment');
const httpStatus = require('http-status');
const APIError = require('../../helpers/APIError');
const config = require('../../../config/config');


/**
 * PaymentLog Schema
 *
 * We got some status here for the paymentLogs
 * 0 -> OTHERS
 * 1 -> KREDIT
 * 2 -> DEBIT
 */
const PaymentLogSchema = new mongoose.Schema({
  transactionId: String,
  type: Number,
  store: {
    type: mongoose.Schema.ObjectId,
    ref: 'Store'
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  remainingCredit: Number,
  gatewayType: {
    type: String,
    enum: ['midtrans', 'vabni', 'dana', 'gopay']
  },
  detail: {},
  description: {
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
PaymentLogSchema.method({
});


/**
 * Post save function. so we can determine user's termin
 */
PaymentLogSchema.pre('save', function(next){
  next();
});



/**
 * Statics
 */
PaymentLogSchema.statics = {
  /**
   * Get paymentLog
   * @param {ObjectId} id - The objectId of paymentLog.
   * @returns {Promise<PaymentLog, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((paymentLog) => {
        if (paymentLog) {
          return paymentLog;
        }
        const err = new APIError('No such paymentLog exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List paymentLogs in descending order of 'createdAt' timestamp.
   * @param {number} skip - Number of paymentLogs to be skipped.
   * @param {number} limit - Limit number of paymentLogs to be returned.
   * @returns {Promise<PaymentLog[]>}
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
   * @param {ObjectId} tid - The objectId of paymentLog
   * @param {ObjectId} pid - The objectId of termin
   * @returns {Promise<PaymentLog[]>}
   */
   checkPayment(tid, pid) {
     return this.findById(tid)
      .exec()
      .then(paymentLog => {
        if(!paymentLog){
          const err = new APIError('No such paymentLog exists!', httpStatus.NOT_FOUND);
          return Promise.reject(err);
        }

        // checking payment status
        let isPaid = false;
        for(let i=0;i<paymentLog.termins.length;i++){
          if((paymentLog.termins[i].paid._id === pid) && paymentLog.termins[i].paid.status){
            isPaid = true;
          }
        }

        if(isPaid){
          const err = new APIError(`Payment with id ${pid} is already paid!`, httpStatus.NOT_FOUND);
          return Promise.reject(err);
        } else{
          return paymentLog;
        }
      })
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


/**
 * @typedef Transaction
 */
module.exports = mongoose.connection.useDb(config.mongo.user_host).model('PaymentLog', PaymentLogSchema);

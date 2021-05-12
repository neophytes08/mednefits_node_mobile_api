const Promise = require('bluebird');
const mongoose = require('mongoose');
const moment = require('moment');
const httpStatus = require('http-status');
const APIError = require('../../helpers/APIError');
const config = require('../../../config/config');
const request = require('request');



let crnt = moment();

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
 * Transaction Schema
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
const TransactionSchema = new mongoose.Schema({
  transactionNumber: {
    type: String,
    required: true,
    unique: 'Please provide an unique transaction number'
  },
  otp: {
    secret: String,
    timestamp: Number,
    encoding: String
  },
  convenienceFee: {
    type: Number
  },
  termins: [{
    number: Number,
    total: Number,
    method: String,
    paid: {
      status: {
        type: Boolean,
        default: false
      },
      status_code: String,
      date: String,
      method: String,
      payment_id: String,    // from the payment gateway
      order_id: String,
      paymentGateway: {
        type: String,
        enum: ['midtrans', 'xendit', 'dana', 'gopay']
      }
    },
    due: {
      date: Date,
      notified: {
        type: Boolean,
        default: false,
        at: Number
      },
      lastNotified: {
        type: Number,
        default: 0
      }
    },
    lateFee: {
      type: Number,
      default: 0
    },
    discount: {
      type: Number,
      default: 0
    },
    reimbursement: {
      type: Number,
      default: 0
    },
    returnedPayment: {
      type: Number,
      default: 0
    }
  }],
  status: {
    type: Number,
    required: true,
    default: 0
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  merchant: {
    // type: mongoose.Schema.ObjectId,
    // ref: 'Merchant'
    type: String
  },
  store: {
    type: mongoose.Schema.ObjectId,
    ref: 'Store'
    // type: String
  },
  total: Number,
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
  voucher: {
    type: mongoose.Schema.ObjectId,
    ref: 'Voucher'
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
TransactionSchema.method({
});


/**
 * Post save function. so we can determine user's termin
 */
TransactionSchema.pre('save', async function(next){
  if(this.termins.length < 1){

    // divide the transaction total to EmpatKali and push it into transaction detail
    let devidedTotal = Math.round(this.total / 4);
    let termins = [];

    let terminTime = new Date();

    // inserting first payment. it only has 1 hour expired, since the transaction is created
    termins.push({
      number: 1,
      total: devidedTotal,
      due: {
        date: terminTime.setHours(23,59,59,999),
        notified: true
      }
    });

    // creating va
    let expireDate, order_id_creator, vaAssets, initCharge, dueDate;

    for(let i=2;i<5;i++){
      // collecting the va requirements
      // dueDate = terminTime.setDate(terminTime.getDate() + 14);
      // dueDate = terminTime.setDate(terminTime.getDate() + this.terminDuration);
      expireDate = (this.terminDuration == 14) ? moment(dueDate).add((i-1) * 2, 'w').endOf('day').format('YYYY-MM-DD HH:mm:ss') : moment(dueDate).add(i-1, 'M').endOf('day').format('YYYY-MM-DD HH:mm:ss');
      order_id_creator = `2-${this.transactionNumber}-${i}`;
      vaAssets = {
        trxid: order_id_creator,
        jumlah: devidedTotal,
        expire: expireDate,
        nama: this.transactionNumber
      };
      
      // get the Virtual Account
      initCharge = await requester({
        uri: `http://149.129.252.24/bni/cr8${(process.env.NODE_ENV === 'production') ? '-prod' : ''}.php`,
        method: 'POST',
        json: vaAssets
      });

      termins.push({
        number: i,
        total: devidedTotal,
        due: {
          // date: dueDate,
          date: expireDate,
          notified: false
        },
        paid: {
          status_code: '201',
          payment_id: initCharge.virtual_account,
          date: expireDate,
          order_id: order_id_creator,
          method: 'vabni',
          transaction_time: expireDate
        }
      });
    }


    // pushing transaction termins
    this.termins = termins;

    next();
  }

  next();
});



/**
 * Statics
 */
TransactionSchema.statics = {
  /**
   * Get transaction
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
        const err = new APIError('No such transaction exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List transactions in descending order of 'createdAt' timestamp.
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
   * @returns {Promise<Transaction[]>}
   */
   checkPayment(tid, pid) {
     return this.findById(tid)
      .exec()
      .then(transaction => {
        if(!transaction){
          const err = new APIError('No such transaction exists!', httpStatus.NOT_FOUND);
          return Promise.reject(err);
        }

        // checking payment status
        let isPaid = false;
        for(let i=0;i<transaction.termins.length;i++){
          if((transaction.termins[i].paid._id === pid) && transaction.termins[i].paid.status){
            isPaid = true;
          }
        }

        if(isPaid){
          const err = new APIError(`Payment with id ${pid} is already paid!`, httpStatus.NOT_FOUND);
          return Promise.reject(err);
        } else{
          return transaction;
        }
      })
    },

  /**
   * Updating pin
   * @param {ObjectId} - The objectId of transcation
   * @returns {Promise<Transaction[]>}
   */
  async updatePIN(tid){
    return this.findById(tid)
      .exec()
      .then(transaction => {
        if(!transaction){
          const err = new APIError('No such transaction exists!', httpStatus.NOT_FOUND);
          return Promise.reject(err);
        }

        transaction.otp.number = otpCreator();
        transaction.otp.expired = new Date().addSeconds(30);

        transaction.save((err) => {
          if(err) throw err;

          return transaction;
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



/*
 * Helper functions
 */
function requester(params) {
  return new Promise((resolve, reject) => {
    try{
      request(params, (err, httpResponse, body) => {
        if (err) {
            reject(err);
        } else {
          const resultVar = JSON.parse(JSON.stringify(body));
          resolve(resultVar);
        }
      });
    } catch(e){
      reject(e);
    }

  });
}


/**
 * @typedef Transaction
 */
module.exports = mongoose.connection.useDb(config.mongo.user_host).model('ApprovedTransaction', TransactionSchema);

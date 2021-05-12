const Joi = require('joi');

module.exports = {
  // POST /api/transactions
  createApprovedTransaction: {
    body: {
      qr: Joi.string(),
      md5: Joi.string(),
      terminDuration: Joi.number().valid([14, 30])
      // store: Joi.string().hex().when('md5', {is: Joi.exist(), then: Joi.required()}),
      // store: Joi.string().hex(),
      // user_mobileNumber: Joi.string().when('md5', {is: Joi.exist(), then: Joi.required()}),
      // amount: Joi.number().when('md5', {is: Joi.exist(), then: Joi.required()}),
      // transactionNumber: Joi.string().when('md5', {is: Joi.exist(), then: Joi.required()}),
      // token: Joi.string().when('md5', {is: Joi.exist(), then: Joi.required()})
    }
  },

  // PUT /api/transactions/:transactionId
  updateApprovedTransaction: {
    body: {
      // status: Joi.number().required()
    },
    params: {
      transactionId: Joi.string().hex().required()
    }
  },

  //  POST /api/approvedtransation/generate
  generate: {
    body: {
      // mobileNumber: Joi.string().regex(/^08\d[0-9]{7,9}$/g).required(),
      total: Joi.number().required(),
      transactionNumber: Joi.string().required()
    }
  },

  //  POST /api/approvedtransation/generate
  generateJWTLess: {
    body: {
      storeId: Joi.string().hex().required(),
      // secret: Joi.string().required(),
      // mobileNumber: Joi.string().regex(/^08\d[0-9]{7,9}$/g).required(),
      total: Joi.number().required(),
      transactionNumber: Joi.string().required()
    }
  },

  updateCardToken: {
    body: {
      // card_cvv: Joi.string().required(),
      transactionNumber: Joi.string().required(),
      storeId: Joi.string().hex().required(),
      // secret: Joi.string().required()
    }
  },

  getUserDefaultCardDetail: {
    body: {
      storeId: Joi.string().hex().required(),
      // secret: Joi.string().required()
    }
  }

}
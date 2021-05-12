const Joi = require('joi');

module.exports = {
  // POST /api/transactions
  createApprovedTransaction: {
    body: {
      qr: Joi.string(),
      md5: Joi.string(),
      // store: Joi.string().hex().when('md5', {is: Joi.exist(), then: Joi.required()}),
      store: Joi.string().hex(),
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

  // POST /api/approvedtransactions/v3
  createFromPreApproved: {
    transactionNumber: Joi.string().required()
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

  listForPlugin: {
    body: {
      storeId: Joi.string().hex().required(),
      // secret: Joi.string().required()
    }
  },

  danaCallback: {
    body: {
      jml: Joi.number().required(),
      txid: Joi.string().required(),
      danaid: Joi.string().required(),
      jam: Joi.string().required()
    }
  },

  gopayCallback: {
    body: {
      jml: Joi.number().required(),
      txid: Joi.string().required(),
      gopayid: Joi.string().required(),
      jam: Joi.string().required()
    }
  }

}
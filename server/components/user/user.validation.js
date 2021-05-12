const Joi = require('joi');

module.exports = {
  // POST /api/users
  createUser: {
    body: {
      // mobileNumber: Joi.string().regex(/^[0-9][0-9]{10,13}$/).required(),
      mobileNumber: Joi.string().regex(/^08\d[0-9]{7,12}$/g).required()
    }
  },

  // UPDATE /api/users/:userId
  updateUser: {
    body: {
      // temporary null
    },
    params: {
      userId: Joi.string().hex().required()
    }
  },

  // GET /api/users/verification/sms
  verifyToken: {
    query: {
      uid: Joi.string().hex().required(),
      ac: Joi.required(),
      as: Joi.required()
    }
  },

  // POST /api/users/verification/sms
  resendToken: {
    body: {
      userId: Joi.string().hex().required(),
      mobileNumber: Joi.required()
    }
  },

  // POST /api/auth/login
  login: {
    body: {
      mobileNumber: Joi.string().required(),
      password: Joi.string().required()
    }
  },

  // GET /api/users/sign
  sign: {
    query: {
      uid: Joi.string().hex().required(),
      ac: Joi.string().required(),
      as: Joi.string().required(),
      mn: Joi.string().required()
    }
  },

  // POST /api/users/card
  insertCard: {
    body: {
      mobileNumber: Joi.string().required(),
      card_number: Joi.string().required(),
      card_exp_month: Joi.number().required(),
      card_exp_year: Joi.number().required(),
      card_cvv: Joi.number().required(),

      // FOR TESTING 
      // saved_token_id: Joi.string().required(),
      // masked_card: Joi.string().required(),
      // bank: Joi.string().required(),
      // card_type: Joi.string().required()
    }
  }
}
const Joi = require('joi');

module.exports = {
  // POST /api/auth/login
  login: {
    body: {
      identity: Joi.string().required(),
      password: Joi.string().required(),
    }
  },

  oneTapLogin: {
    body: {
      client_id: Joi.number().required()
      // user_id: Joi.number().required(),
    }
  },

  sendOtpMobile: {
    body: {
      mobile: Joi.string().required(),
      mobile_country_code: Joi.string().required()
    }
  },

  validateOtpMobile: {
    body: {
      user_id: Joi.number().required(),
      otp_code: Joi.string().required()
    }
  },

  checkMemberExist: {
    body: {
      mobile: Joi.string().required()
    }
  },

  createNewPasswordByMember: {
    body: {
      password: Joi.string().required(),
      password_confirm: Joi.string().required(),
      user_id: Joi.number().required()
    }
  },

  addPostalCodeMember: {
    body: {
      postal_code: Joi.string().required(), 
      user_id: Joi.number().required()
    }
  }
};

const Joi = require('joi');

module.exports = {
  // POST /api/fees
  create: {
    body: {
      type: Joi.string().required(),
      description: Joi.string().required(),
      amount: Joi.number().required()
    }
  },

  // PUT /api/fees/:feeId
  update: {
    params: {
      feeId: Joi.string().hex().required()
    }
  },

  // PUT /api/fees/
  updateFromType: {
    body: {
      type: Joi.string().required()
    }
  },

  // DELETE /api/fees
  removeFromType: {
    query: {
      t: Joi.string().required()
    }
  },

  // PUT /api/fees/:feeId
  remove: {
    params: {
      feeId: Joi.string().hex().required()
    }
  }
}
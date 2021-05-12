const validate = require('express-validation');
const paramValidation = require('./fee.validation');
const feeCtrl = require('./fee.controller');



module.exports =  app => {
  app.route('/api/fees/')
    /** GET /api/fees - To get transaction fee */
    .get(feeCtrl.list);

  app.route('/api/:feeId')
    /** GET /api/fees/:feeId - To get transaction fee */
    .get(feeCtrl.get);

  /** Load user when API with userId route parameter is hit */
  app.param('feeId', feeCtrl.load);
};

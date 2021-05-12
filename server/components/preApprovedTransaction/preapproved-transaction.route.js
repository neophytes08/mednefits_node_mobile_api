const validate = require('express-validation');
const paramValidation = require('./preapproved-transaction.validation');
const preApprovedTransactionCtrl = require('./preapproved-transaction.controller');
const { invokeRolesPolicies, isAllowed } = require('./preapproved-transaction.policy');

invokeRolesPolicies();           // invoking roles policies


module.exports =  app => {
  app.route('/api/preapprovedtransactions/')
    /** POST /api/approvedTransactions - Create new approved transaction */
    .post(validate(paramValidation.createApprovedTransaction), preApprovedTransactionCtrl.create);


  app.route('/api/preapprovedtransactions/init')
    /** POST /api/prepreapprovedtransactions/init **/
    .post(validate(paramValidation.createApprovedTransaction), preApprovedTransactionCtrl.init);

  app.route('/api/preapprovedtransactions/init/internal')
    /** POST /api/prepreapprovedtransactions/init **/
    .post(preApprovedTransactionCtrl.initInternal);

  app.route('/api/preapprovedtransactions/token')
    /** POST /api/prepreapprovedtransactions - Update preapprovedtransaction card token */
    .post(validate(paramValidation.updateCardToken), preApprovedTransactionCtrl.updateCardToken);

  app.route('/api/preapprovedtransactions/defaultcard/:transactionNumber')
    /** POST /api/:transactionNumber/defaultcard - Get list of approvedTransactions */
    .post(validate(paramValidation.getUserDefaultCardDetail), preApprovedTransactionCtrl.getUserDefaultCardDetail)

  /** Load approvedTransaction when API with transactionNumber route parameter is hit */
  app.param('transactionNumber', preApprovedTransactionCtrl.loadTransactionNumber);

  /** Load approvedTransaction when API with approvedTransactionId route parameter is hit */
  app.param('preApprovedTransactionId', preApprovedTransactionCtrl.load);
};
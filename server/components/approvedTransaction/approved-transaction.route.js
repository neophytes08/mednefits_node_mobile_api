const validate = require('express-validation');
const paramValidation = require('./approved-transaction.validation');
const approvedTransactionCtrl = require('./approved-transaction.controller');
const { invokeRolesPolicies, isAllowed } = require('./approved-transaction.policy');

invokeRolesPolicies();           // invoking roles policies


module.exports =  app => {
  app.route('/api/approvedtransactions/')
    /** GET /api/approvedTransactions - Get list of approvedTransactions */
    .get(isAllowed, approvedTransactionCtrl.list)

    /** POST /api/approvedTransactions - Create new approved transaction */
    .post(validate(paramValidation.createApprovedTransaction), approvedTransactionCtrl.create);


  app.route('/api/approvedtransactions/v3')
    /** POST /api/approvedTransactions/v3 - Create new approved transaction in newest version */
    .post(validate(paramValidation.createFromPreApproved), approvedTransactionCtrl.createFromPreApproved);

  app.route('/api/approvedtransactions/generate')
    .post(isAllowed, validate(paramValidation.generate), approvedTransactionCtrl.generateQR);

  app.route('/api/approvedtransactions/generateal')
    .post(validate(paramValidation.generateJWTLess), approvedTransactionCtrl.generateQRJWTLess);

  app.route('/api/approvedtransactions/plugin')
    .post(validate(paramValidation.listForPlugin), approvedTransactionCtrl.listForPlugin);

  app.route('/api/approvedtransactions/danacallback')
    .post(validate(paramValidation.danaCallback), approvedTransactionCtrl.danaCallback);

  app.route('/api/approvedtransactions/gopaycallback')
    .post(validate(paramValidation.gopayCallback), approvedTransactionCtrl.gopayCallback);

  app.route('/api/approvedtransactions/check/callback/:transactionNumber')
    .get(approvedTransactionCtrl.checkCallback);

  app.route('/api/approvedtransactions/updatefailed/:transactionNumber')
    .post(approvedTransactionCtrl.updateFailedTransactionNotification);

  /** Load approvedTransaction when API with approvedTransactionId route parameter is hit */
  app.param('approvedTransactionId', approvedTransactionCtrl.load);
};
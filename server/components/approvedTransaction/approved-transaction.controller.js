// const 'babel-polyfill';
// async await handlers is express.js
require('express-async-errors');

const Promise = require('bluebird');
const crypto = require('crypto');
const ApprovedTransaction = require('./approved-transaction.model');
const PreApprovedTransaction = require('../preApprovedTransaction/preapproved-transaction.model');
const CallbackRules = require('../callbackRules/callback-rules.model');
const PaymentLog = require('../paymentLog/payment-log.model');
const TransactionNotification = require('../transactionNotification/transaction-notification.model');
const User = require('../user/user.model');
const Fee = require('../fee/fee.model');
const Merchant = require('../merchant/merchant.model');
const Store = require('../store/store.model');
const TransactionLog = require('../transactionLog/transaction-log.model');
const httpStatus = require('http-status');
const APIError = require('../../helpers/APIError');
const config = require('../../../config/config');
const request = require('request');
const UserLog = require('../userLog/user-log.model');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const moment = require('moment');
const HelperFunctions = require('../../helpers/functions');
const FailedTransactionNotification = require('../failedTransaction/failed-transaction.model');


String.prototype.equals = function(that) {
    return this === that;
}


/**
 * Load approvedTransaction and append to req.
 */
async function load(req, res, next, id) {
	req.approvedTransactions = await ApprovedTransaction.get(id); // eslint-disable-line no-param-reassign
	return next();
}

/**
 * Get approvedTransaction
 * @returns {ApprovedTransaction}
 */
function get(req, res) {
	return res.json(req.approvedTransactions);
}

/**
 * Get transaction lists
 */
async function listForPlugin(req, res, next){
	const { limit = 15, skip = 0 } = req.query;
	const store = await Store.findOne({
		_id: req.body.storeId,
		// salt: req.body.secret
	});

	if(!store) return next(new APIError('You are not allowed here', httpStatus.FORBIDDEN, true));

	let searchConditions = {};
	searchConditions.store = store._id;

	const transactions = await ApprovedTransaction.find(searchConditions)
		.select('user createdAt transactionNumber')
	  	.populate({
	  		path: 'user',
	  		model: User,
	  		select: 'mobileNumber'
	  	})
	  	.sort({ createdAt: -1 })
	    .skip(+skip)
	    .limit(+limit);

	return res.json(transactions);
}

/**
 * Get transaction list.
 * @property {number} req.query.skip - Number of approvedTransactions to be skipped.
 * @property {number} req.query.limit - Limit number of approvedTransactions to be returned.
 * @returns {ApprovedTransaction[]}
 */
async function list(req, res, next) {
	const merchant = req.user;
	let searchConditions = {};


	// if you want to search by store. by default, it'll search by all store from this merchant
	if(req.query.store){
		searchConditions.store = req.query.store;
	} else{
		let storeCondition = {merchant: req.user._id};

		// looking for store type
		if(req.query.type){
			if(req.query.type === 'online' || req.query.type === 'offline'){
				storeCondition.online = (req.query.type === 'offline') ? false : true;
			}
		}

		const storeByMerchant = await Store.find(storeCondition, '_id');
		let stores = [];

		// create array of id
		for(let i=0;i<storeByMerchant.length;i++){stores.push(storeByMerchant[i]._id);}

		searchConditions.store = {$in: stores};
	}

	// check status
	if(req.query.st) searchConditions.status = req.query.st;

	if(req.query.umn){
		const userMobileNumber = req.query.umn || '';
		const user = await User.findOne({mobileNumber: userMobileNumber});

		// throw error if user id is not valid
		if(!user){
			const err = new APIError('User not found!', httpStatus.NOT_FOUND, true);
			return next(err);
		}
		searchConditions.user = user._id;
	}


	// date range
	if(req.query.start && req.query.end){
		let dateStart, dateEnd;
		if(req.query.start) dateStart = moment(req.query.start);
		if(req.query.end) dateEnd = moment(req.query.end);

		searchConditions.createdAt = {
			'$gte': new Date(dateStart.startOf('day')),
			'$lte': new Date(dateEnd.endOf('day'))
		}
	}


	const transactions = await ApprovedTransaction.find(searchConditions);
	return res.send(transactions);
}

/**
 * Get Transactions By Merchant
 */
async function getByMerchant(req, res, next){
	let stores = req.query.store || [];

	if(!req.query.store){
		const merchant = await Store.find({merchant: req.user._id}, '_id');

		// create array of id
		for(let i=0;i<merchant.length;i++){stores.push(merchant[i]._id);}
	}

	return res.json(await ApprovedTransaction.find({
		store: {
			$in: stores
		}
	}));
}

/**
 * Init approved transaction
 * @property {string} req.body.user_mobileNumber - The mobile number of the user
 * @property {number} req.body.amount - The amount of approved transaction given by merchant
 */
async function init(req, res, next){
	const merchant = await Store.findById(req.user._id);
	const userMobileNumber = req.body.user_mobileNumber || '';
	const amount = req.body.amount || 0;
	const transactionIds = req.body.transactions;
	const tokens = req.body.token;

	// controller's assets
	let totalTransaction = 0;

	const user = await User.findOne({mobileNumber: userMobileNumber});

	// if user not found from mobileNumber
	if(!user) return next(new APIError('User not found!', httpStatus.NOT_FOUND, true));

	// validating if user is passing the transaction ids
	let transactionSearchConditions = {};
	if(transactionIds) transactionSearchConditions = {'_id': { '$in': transactionIds }, 'status': 0};
	else transactionSearchConditions = {user: user._id, status: 0, "store": merchant._id};

	// get the transactions
	const transactions = await Transaction.find(transactionSearchConditions);

	// check if there is no transaction status = 0, or maybe no transaction matched with the ids
	if(transactions.length < 1) return next(new APIError('No Transaction found', httpStatus.UNPROCESSABLE_ENTITY, true));

	// calculating total of the transactions
	if(req.body.totalTransaction){
		totalTransaction = req.body.totalTransaction;
	} else{
		for(let i=0;i<transactions.length;i++){
			totalTransaction += transactions[i].total;
		}
	}


	// when total of the transactions is greater than user's remaining credit throw error
	if(totalTransaction > user.remainingCredit) return next(new APIError('Insufficient user credit!', httpStatus.UNPROCESSABLE_ENTITY, true));

	// when total of the transactions is greater than merchant's given credit throw error
	if(totalTransaction > amount) return next(new APIError(`Insufficient merchant\'s given credit. Please select some transactions which less than equals to ${amount}`, httpStatus.UNPROCESSABLE_ENTITY, true));


	// creating transaction Id's array
	let tid = [];
	for(let i=0;i<transactions.length;i++){
		tid.push(transactions[i]._id);
	}

	// check if user is allowed to create transaction
	if(user.status !== 2) return next(new APIError(`User is not allowed to make this transaction.`, httpStatus.UNPROCESSABLE_ENTITY, true));


	// creating new approved transaction
	let approvedTransaction = new ApprovedTransaction({
		// transactionNumber: `${merchant.name.replace(/ /g,"_").toUpperCase()}-${Date.now()}`,
		transactionNumber: (req.body.transactionNumber) ? req.body.transactionNumber : `${merchant.name.replace(/ /g,"_").toUpperCase()}${Date.now()}`,
		total: totalTransaction,
		transactions: tid,
		// merchant: merchant._id,
		store: merchant._id,
		user: user._id
	});

	let result = await approvedTransaction.save();

	// Push Notification
	await notifier({
		regId: user.regId,
		title: 'Pending Payment',
		body: `Pending payment ${result.transactionNumber} sebesar Rp ${totalTransaction}`
	});

	return res.json(result);
}

/**
 * Approving approved transaction
 * @property {string} req.body.transactionNumber - The transaction id
 * @property {string} req.body.token - The OTP Number which already give from socket
 * @property {string} req.body.md5 - Such as a secret
 */
async function approve(req, res, next){
	let merchant, approvedTransaction, user, inmd5;

	// very first validation
	if(!req.body.transactionNumber) return next(new APIError('No transaction number found', httpStatus.FORBIDDEN, true));
	
	// check if request is within qrcode or not
	if(req.body.qr){
		approvedTransaction = await ApprovedTransaction.findOne({transactionNumber: req.body.transactionNumber});
		user = await User.findById(approvedTransaction.user);
		merchant = await Store.findById(approvedTransaction.store);
		inmd5 = crypto
		    .createHash('md5')
		    .update(`${approvedTransaction.total}${approvedTransaction.transactionNumber}${approvedTransaction.store}${merchant.salt}`)
		    .digest('hex');

		if(req.body.qr !== inmd5) return next(new APIError('You have wrong md5', httpStatus.FORBIDDEN, true));
	} else{
		// second validation
		if(!req.body.token) return next(new APIError('No token found', httpStatus.FORBIDDEN, true));
		// if(!req.user._id) return next(new APIError('No store session found', httpStatus.FORBIDDEN, true));
		

		// get approved transaction
	  	approvedTransaction = await ApprovedTransaction.findOne({transactionNumber: req.body.transactionNumber});
	  	merchant = await Store.findById(approvedTransaction.store);
	  	user = await User.findById(approvedTransaction.user);
	  	inmd5 = crypto
		    .createHash('md5')
		    .update(`${approvedTransaction.total}${approvedTransaction.transactionNumber}${approvedTransaction.store}${merchant.salt}`)
		    .digest('hex');


		const token = speakeasy.totp.verify({
			token: req.body.token,
			secret: user.otp.secret,
			encoding: user.otp.encoding,
			time: user.otp.timestamp
		});

		if(req.body.md5 !== inmd5) return next(new APIError('You have wrong md5', httpStatus.FORBIDDEN, true));
		if(!token) return next(new APIError('Your token is invalid', httpStatus.FORBIDDEN, true));
	}



	// TRANSACTION FIRST PAYMENT
	// charge user's credit card for first payment
	let flags = {
		found: false,
		isPaid: false,
		nominal: approvedTransaction.termins[0].total,
		index: approvedTransaction.termins[0].number,
		token: false,
		termin_id: approvedTransaction.termins[0]._id
	};
	const auth = new Buffer(config.midtrans.server_key + ':' + '').toString('base64');
	// let order_id_creator = `PAYMENT-${result.transactionNumber}-${flags.index}`;
	let order_id_creator = `2-${approvedTransaction.transactionNumber}-${flags.index}`;
	
	// get card token if client didn't pass token property
	flags.token = getUserDefaultCard(user);
	// if no cards, then throw error
	if(!flags.token){
		return next(new APIError(`No card found`, httpStatus.FORBIDDEN, true));
	}
	
	// charge to midtrans
	let initCharge = await HelperFunctions.requester({
		uri: config.midtrans.address + '/charge',
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + auth,
			'Content-Type': 'application/json'
		},
		json: {
			payment_type: 'credit_card',
			transaction_details: {
				order_id: order_id_creator,
				gross_amount: flags.nominal
			},
			credit_card: {
				token_id: flags.token,
				save_token_id: true
			}
		}
	});

	// if cannot charging the card, throw an error
	if(initCharge.status_code !== '200' && initCharge.status_code !== '201'){
		const errs = new APIError('Cannot charge the card. Transaction declined', httpStatus.INTERNAL_SERVER_ERROR, true);
		return next(errs);
	}

	approvedTransaction.termins[0].paid.status = true;
	approvedTransaction.termins[0].paid.status_code = initCharge.status_code;
	approvedTransaction.termins[0].paid.date = initCharge.transaction_time;
	approvedTransaction.termins[0].paid.method = initCharge.payment_type;
	approvedTransaction.termins[0].paid.payment_id = initCharge.transaction_id;

	// change status
	approvedTransaction.status = 1;

	// updating transaction
	await approvedTransaction.save();


	// subtracting user's balance
	await User.findOneAndUpdate({_id: user._id}, {$inc: {remainingCredit: -approvedTransaction.total }}, {upsert: true, setDefaultsOnInsert: true});

	// update transaction status
	await Transaction.update({ _id: { $in: approvedTransaction.transactions } }, {$set: {status: 1}}, {multi: true});

	return res.json({message: 'Transaction success'});
}


/**
 * Generating QR Code
 * @property {number} req.body.total - The given amount from merchant
 * @property {string} req.body.transactionNumber - The number of the invoice
 */
async function generateQR(req, res, next){
	const merchant = req.user;
	const store = await Store.findById(merchant._id);
	const total = req.body.total;
	const invoiceNumber = req.body.transactionNumber;
	// const mobileNumber = req.body.mobileNumber;
	const inmd5 = crypto
		    .createHash('md5')
		    .update(`${req.body.total}${req.body.transactionNumber}${store._id}${store.salt}`)
		    .digest('hex');
	// let qrData = `${store._id}|${total}|${inmd5}|${req.body.transactionNumber}|${mobileNumber}`;
	let qrData = `${store._id}|${total}|${inmd5}|${req.body.transactionNumber}`;
	

	// looking for custom field
	let keys = Object.keys(req.body);

	// if(keys.length > 3){
	if(keys.length > 2){
		let counter = 0;

		for(let i=0;i<keys.length;i++){
			if(counter < 5){
				// if(keys[i] !== 'transactionNumber' && keys[i] !== 'total' && keys[i] !== 'mobileNumber'){
				if(keys[i] !== 'transactionNumber' && keys[i] !== 'total' && keys[i] !== 'secret' && keys[i] !== 'storeId' && keys[i] !== 'mobileNumber'){
					qrData += `|${keys[i]}:${req.body[keys[i]]}`;
					++counter;
				}
			}
		}
	}

	// check override notification url
	if(req.headers['x-append-notification'] || req.headers['x-override-notification']){
		let isOverride = false, uris = req.headers['x-append-notification'];

		if(req.headers['x-override-notification']){
			isOverride = true;
			uris = req.headers['x-override-notification'];
		}

		await CallbackRules.update({store: req.body.storeId, transactionNumber: req.body.transactionNumber}, {
			$set: {
				store: req.body.storeId,
				transactionNumber: req.body.transactionNumber,
				override: isOverride,
				uris: uris.split(',')
			}
		}, {upsert: true});
	}

	console.log(qrData);
	res.json({
		md5: inmd5,
		qr: await QRCode.toDataURL(qrData)
	});
}


/**
 * Generating QR Code
 * @property {number} req.body.total - The given amount from merchant
 * @property {string} req.body.transactionNumber - The number of the invoice
 */
async function generateQRJWTLess(req, res, next){
	const store = await Store.findOne({
		_id: req.body.storeId,
		// salt: req.body.secret
	});

	if(!store) return next(new APIError('You are not allowed here', httpStatus.FORBIDDEN, true));

	const total = req.body.total;
	const invoiceNumber = req.body.transactionNumber;
	// const mobileNumber = req.body.mobileNumber;
	const inmd5 = crypto
		    .createHash('md5')
		    .update(`${req.body.total}${req.body.transactionNumber}${store._id}${store.salt}`)
		    .digest('hex');
	// let qrData = `${store._id}|${total}|${inmd5}|${req.body.transactionNumber}|${mobileNumber}`;
	let qrData = `${store._id}|${total}|${inmd5}|${req.body.transactionNumber}`;


	// looking for custom field
	let keys = Object.keys(req.body);

	// if(keys.length > 5){
	if(keys.length > 4){
		let counter = 0;

		for(let i=0;i<keys.length;i++){
			if(counter < 5){
				if(keys[i] !== 'transactionNumber' && keys[i] !== 'total' && keys[i] !== 'secret' && keys[i] !== 'storeId' && keys[i] !== 'mobileNumber'){
					qrData += `|${keys[i]}:${req.body[keys[i]]}`;
					++counter;
				}
			}
		}
	}

	// check override notification url
	if(req.headers['x-append-notification'] || req.headers['x-override-notification']){
		let isOverride = false, uris = req.headers['x-append-notification'];

		if(req.headers['x-override-notification']){
			isOverride = true;
			uris = req.headers['x-override-notification'];
		}

		await CallbackRules.update({store: req.body.storeId, transactionNumber: req.body.transactionNumber}, {
			$set: {
				store: req.body.storeId,
				transactionNumber: req.body.transactionNumber,
				override: isOverride,
				uris: uris.split(',')
			}
		}, {upsert: true});
	}
	console.log(qrData);

	res.json({
		md5: inmd5,
		qr: await QRCode.toDataURL(qrData)
	});

	// res.json({
	// 	md5: inmd5,
	// 	qr: await brandedQRCode.generate({text: qrData})
	// })
}


/**
 * Create approved transaction
 * @property {string} req.body.user_mobileNumber - The mobile number of the user
 * @property {number} req.body.amount - The amount of approved transaction given by merchant
 * @property {string} req.body.qr - The md5 from the scanned qr code
 * @property {string} req.body.md5 - The md5 which sent from store
 * @property {string} req.body.store - The objectId from the store
 * @property {string} req.body.token - The otp which sent to user's mobileNumber
 * @property {string} req.body.transactionNumber - The transaction number
 *
 * this one will send a callback to the merchant, with status like this:
 * 200 -> success
 * 201 -> OTP not valid
 * 202 -> duplicate invoice number
 * 203 -> insufficient user's balance
 * 204 -> md5 not valid
 * 205 -> user is not allowed
 * 206 -> cannot charge the card
 * 207 -> user not found
 * 208 -> store not found
 * 209 -> card not found
 * 210 -> unexpected error
 * 211 -> Invalid parameter value in the request
 * 212 -> Store is not in active status. Transaction rejected
 * 213 -> Token not valid
 * 214 -> You are not the owner of this mobile number
 */
async function create(req, res, next){
	let store, userMobileNumber, amount, tokens, transactionNumber, md5, tn;
	let tl = {transactionNumber: 'unknown'};

	if(req.body.qr){
		let qrAssets = req.body.qr;
		qrAssets = qrAssets.split('|');

		if(qrAssets.length < 4 || !req.body.token) return res.json(await sendCallback(req.body, '', '211', '', tl));

		store = qrAssets[0];
		amount = qrAssets[1] || 0;
		transactionNumber = qrAssets[3]; tn = qrAssets[3];
		md5 = qrAssets[2];

		// set transaction log
		tl.store = store;
		tl.transactionNumber = transactionNumber;
		tl.total = amount;

		// validating token / jwt
		try{
			const decodedToken = jwt.verify(req.body.token, config.userJwtSecret);
			if(decodedToken.dataToken){
				if(!decodedToken.dataToken.mobileNumber) return res.json(await sendCallback(req.body, '', '213', '', tl));

				userMobileNumber = decodedToken.dataToken.mobileNumber;
			} else{
				return res.json(await sendCallback(req.body, '', '213', '', tl));
			}

		} catch(e){
			return res.json(await sendCallback(req.body, '', '213', '', tl));
		}


	} else if(req.body.md5){
		if(!req.body.store || !req.body.user_mobileNumber || !req.body.amount || !req.body.token || !req.body.transactionNumber) return res.json(await sendCallback(req.body, '', '211', '', tl));

		store = req.body.store;
		userMobileNumber = req.body.user_mobileNumber;
		amount = req.body.amount || 0;
		tokens = req.body.token;
		transactionNumber = req.body.transactionNumber; tn = req.body.transactionNumber;

		// set transaction log
		tl.store = store;
		tl.transactionNumber = transactionNumber;
		tl.total = amount;

	} else{
		return res.json(await sendCallback(req.body, '', '211', '', tl));
	}

	// cek if convenience fee has been added
	let cf = await Fee.findOne({type: 'convenience'});
	if(!cf) cf = {amount: 0};


	// check store
	let merchant = await Store.findById(store)
		.catch(async e => {
			return res.status(200).json(await sendCallback(req.body, '', '208', '', tl)).end();
		});
	if(!merchant) return res.json(await sendCallback(req.body, '', '208', '', tl));
	if(!merchant.active) return res.json(await sendCallback(req.body, '', '212', '', tl));


	let user = await User.findOne({mobileNumber: userMobileNumber})
	 .catch(async e => {
	 	return res.status(200).json(await sendCallback(req.body, '', '207', '', tl)).end();
	 });
	// if user not found from mobileNumber
	if(!user){
		return res.json(await sendCallback(req.body, merchant.callback, '207', '', tl));
	}

	// adding user to transactionLog
	tl.user = user._id;

	let inmd5 = crypto
	    .createHash('md5')
	    .update(`${amount}${transactionNumber}${merchant._id}${merchant.salt}`)
	    .digest('hex');


	// if in development, pass this validation
	if(process.env.NODE_ENV === 'production'){
		if(req.body.qr){
			if(md5 !== inmd5) return res.json(await sendCallback(req.body, merchant.callback, '204', '', tl));

		} else{
			const token = speakeasy.totp.verify({
				token: req.body.token,
				secret: user.otp.secret,
				digits: user.otp.digits,
				encoding: user.otp.encoding,
				time: user.otp.timestamp
			});

			if(req.body.md5 !== inmd5) return res.json(await sendCallback(req.body, merchant.callback, '204', '', tl));
			if(!token) return res.json(await sendCallback(req.body, merchant.callback, '201', '', tl));
		}
	}

	// when total of the transactions is greater than user's remaining credit throw error
	if(amount > user.remainingCredit){
		// return next(new APIError(await sendCallback(merchant.callback, '203'), httpStatus.UNPROCESSABLE_ENTITY, true));
		return res.json(await sendCallback(req.body, merchant.callback, '203', '', tl));
	}

	// check if user is allowed to create transaction
	if(user.status !== 2){
		// return next(new APIError(await sendCallback(merchant.callback, '205'), httpStatus.UNPROCESSABLE_ENTITY, true));
		return res.json(await sendCallback(req.body, merchant.callback, '205', '', tl));
	}

	// create custom transaction number
	transactionNumber = `${merchant.name.substr(0, 5).toUpperCase()}.${transactionNumber.replace(/-/g, '|')}`;

	// check if transactionNumber exists or not
	if(await ApprovedTransaction.findOne({transactionNumber: transactionNumber})) return res.json(await sendCallback(req.body, merchant.callback, '202', '', tl));

	// creating new approved transaction
	let approvedTransaction = new ApprovedTransaction({
		convenienceFee: cf.amount,
		total: amount,
		transactionNumber: transactionNumber,
		store: merchant._id,
		user: user._id
	});

	let result = await approvedTransaction.save()
		.catch(async e => {
			// return next(new APIError(await sendCallback(merchant.callback, '210'), httpStatus.INTERNAL_SERVER_ERROR, true));
			return res.json(await sendCallback(req.body, merchant.callback, '202', merchant.callback, tl));
		});


	// TRANSACTION FIRST PAYMENT
	// charge user's credit card for first payment
	let flags = {
		found: false,
		isPaid: false,
		nominal: result.termins[0].total + cf.amount,		// --> implementing paying convenience at very first transaction payment
		index: result.termins[0].number,
		token: false,
		termin_id: result.termins[0]._id
	};
	const auth = new Buffer(config.midtrans.server_key + ':' + '').toString('base64');
	// let order_id_creator = `PAYMENT-${result.transactionNumber}-${flags.index}`;
	let order_id_creator = `2-${result.transactionNumber}-${flags.index}`;
	
	// get card token if client didn't pass token property
	flags.token = getUserDefaultCard(user);
	// if no cards, then throw error
	if(!flags.token){
		// return next(new APIError(await sendCallback(merchant.callback, '209'), httpStatus.FORBIDDEN, true));
		return res.json(await sendCallback(req.body, merchant.callback, '209', result._id, tl));
	}
	
	// charge to midtrans
	let initCharge = await HelperFunctions.requester({
		uri: config.midtrans.address + '/charge',
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + auth,
			'Content-Type': 'application/json'
		},
		json: {
			payment_type: 'credit_card',
			transaction_details: {
				order_id: order_id_creator,
				gross_amount: flags.nominal
			},
			credit_card: {
				token_id: flags.token,
				save_token_id: true
			}
		}
	});

	// if cannot charging the card, throw an error
	if(initCharge.status_code !== '200' && initCharge.status_code !== '201'){
		// appending pg detail to transactionLog
		tl.detail = initCharge;

		// removing the transaction first
		await ApprovedTransaction.findByIdAndRemove(result._id);
		return res.json(await sendCallback(req.body, merchant.callback, '206', result._id, tl));
	}

	result.termins[0].paid.status = true;
	result.termins[0].paid.status_code = initCharge.status_code;
	result.termins[0].paid.date = initCharge.transaction_time;
	result.termins[0].paid.method = initCharge.payment_type;
	result.termins[0].paid.payment_id = initCharge.transaction_id;

	// change status
	result.status = 1;

	// updating transaction
	await result.save();

	// subtracting user's balance
	let bill = result.total + cf.amount;
	// await User.findOneAndUpdate({_id: user._id}, {$inc: {remainingCredit: -bill }}, {upsert: true, setDefaultsOnInsert: true})
	await User.findOneAndUpdate({_id: user._id}, {$inc: {remainingCredit: -result.total }}, {upsert: true, setDefaultsOnInsert: true})
		.catch(async e => {
			// if failed

			// cancel the transaction from payment gateway
			await HelperFunctions.requester({
				uri: `${config.midtrans.address}/${order_id_creator}/cancel`,
				method: 'POST',
				headers: {
					Authorization: 'Basic ' + auth,
					'Content-Type': 'application/json'
				}
			});

			// removing the transaction first
			await ApprovedTransaction.findByIdAndRemove(result._id);

			// return next(new APIError(await sendCallback(merchant.callback, '210'), httpStatus.FORBIDDEN, true));
			return res.json(await sendCallback(req.body, merchant.callback, '210', result._id, tl));
		});

	// send email of success transaction to merchant
	await TransactionNotification.update({ approvedTransactionId: result._id }, {
		approvedTransactionId: result._id,
		merchantEmail: {
			sent: false,
			detail: {
				to: merchant.email,
				subject: 'Transaksi Sukses',
				type: 'successTransactionMerchant',
				properties: {
					name: merchant.name,
					transactionNumber: transactionNumber,
					createdAt : result.termins[0].paid.date,
					amount: amount,
					user: userMobileNumber
				}
			}
		},
		userEmail: {
			sent: false,
			detail: {
				to: user.detail.email,
				subject: 'Transaksi Sukses',
				type: 'successTransactionUser',
				properties: {
					clientName: user.detail.name,
					storeName: merchant.name,
					transactionNumber: transactionNumber,
					createdAt : result.termins[0].paid.date,
					total: amount,
					convenienceFee: cf.amount
				}
			}
		},
		userPushNotif: {
			sent: false,
			detail: {
				regId: user.regId,
				title: 'Pending Payment',
				body: `Pending payment ${result.transactionNumber} sebesar Rp ${amount} (exc. biaya layaran Rp ${cf.amount})`
			}
		}
	}, { upsert: true });

	// add to payment log
	let pl = new PaymentLog({
		status_code: '200',
		order_id: transactionNumber,
		transaction_id: transactionNumber,
		gross_amount: amount,
		type: 2,
		user: user._id
	});
	await pl.save()
		.catch(async e => {
			return res.json(await sendCallback(req.body, '', '200', result._id, tl));
		});

		// sending socket
	const username = 'empatkali';
	const password = encodeURIComponent('vH<tV@@E7w.X3cZS');
	const ws = new WebSocket(`ws://${username}:${password}@127.0.0.1:4041/ws/approvedtransactions/store/${store}`);

	ws.on('open', async function open() {
		ws.send(JSON.stringify(await sendCallback(req.body, '', '200', result._id, tl)));
	});

	// send callback to merchant
	res.json(await sendCallback(req.body, merchant.callback, '200', result._id, tl));
}


/**
 * Create approved transaction from dana transaction
 * @property {string} req.body.user_mobileNumber - The mobile number of the user
 * @property {number} req.body.amount - The amount of approved transaction given by merchant
 * @property {string} req.body.transactionNumber - The transaction number
 */
async function danaCallback(req, res, next){
	let transactionNumber = req.body.txid.indexOf('-') > -1 ? req.body.txid.split('-')[1] : req.body.txid;
	let tl = {transactionNumber: 'unknown'};
	let body = req.body;
	let customFields = {};
	let realAmount = req.body.jml;

	const preApprovedTransaction = await PreApprovedTransaction.findOne({transactionNumber: transactionNumber});
	if(!preApprovedTransaction || preApprovedTransaction.status === 1 || !preApprovedTransaction.pending) return res.json(await sendCallback(tl, '', '202', '', tl));

    const merchant = await Store.findById(preApprovedTransaction.store)
    	.populate({path: 'merchant', model: Merchant, select: 'convenienceFee prefix'});
    const user = await User.findById(preApprovedTransaction.user);
    const amount = preApprovedTransaction.total;

    // check if user already input cvv
    // if(!preApprovedTransaction.cardToken) return res.json(await sendCallback(body, merchant.callback, '206', '', tl));

    // adding custom field
    if(preApprovedTransaction.customFields && !isEmpty(preApprovedTransaction.customFields)){
    	let keys = Object.keys(preApprovedTransaction.customFields);
    	for(let i=0;i<keys.length;i++){
	    	customFields[keys[i]] = preApprovedTransaction.customFields[keys[i]];
	    }
    }

    // set transaction log
    tl.store = preApprovedTransaction.store;
    tl.transactionNumber = preApprovedTransaction.transactionNumber;
    tl.total = preApprovedTransaction.total;
    tl.user = preApprovedTransaction.user;

    // cek if convenience fee has been added
    // let cf = await Fee.findOne({type: 'convenience'});
    // if(!cf) cf = {amount: 10000};
    let cf, cftd = (preApprovedTransaction.terminDuration === 14) ? 'twoWeekly' : 'monthly';
	if(merchant.merchant.convenienceFee){
		if(merchant.merchant.convenienceFee[cftd]){
	    	cf = {amount: merchant.merchant.convenienceFee[cftd]};
	    } else{
	    	if(preApprovedTransaction.terminDuration === 30 || preApprovedTransaction.terminDuration === "30") cf = {amount: 25000};
	    	else cf = {amount: 0};
	    }
	} else{
		if(preApprovedTransaction.terminDuration === 30 || preApprovedTransaction.terminDuration === "30") cf = {amount: 25000};
	    else cf = {amount: 0};
	}


    // ########################################################
    // TRANSACTION FIRST PAYMENT

    let userEmail = [];
    let atData = {
		convenienceFee: cf.amount,
		total: preApprovedTransaction.total,
		transactionNumber: preApprovedTransaction.transactionNumber,
		store: preApprovedTransaction.store,
		user: preApprovedTransaction.user,
		terminDuration: preApprovedTransaction.terminDuration
    };

    // get voucher code if for zilingo
	if(preApprovedTransaction.zilingo.is){
		const zilingoVoucher = await HelperFunctions.requester({
			// uri: `http://mon.empatkali.co.id/terimalender${(process.env.NODE_ENV === 'production') ? '-prod' : ''}`,
			uri: `http://mon.empatkali.co.id/zilingo/index.php`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			json: {
				nominal: amount
			}
		});

		userEmail.push({
			to: user.detail.email,
			subject: 'Transaksi Sukses [Zilingo]',
			type: 'successTransactionUserZilingo',
			properties: {
				clientName: user.detail.name,
				storeName: merchant.name,
				transactionNumber: transactionNumber,
				total: numberWithCommas(amount),
				convenienceFee: numberWithCommas(cf.amount),
				voucher: zilingoVoucher.voc,
				expire: zilingoVoucher.expire
			}
		});

		atData['zilingo'] = {
			is: true,
			code: zilingoVoucher.voc,
			expire: zilingoVoucher.expire
		}

		atData.transactionNumber = `${merchant.merchant.prefix}.${zilingoVoucher.voc}`;
		tl.transactionNumber = atData.transactionNumber;
	}


    // creating new approved transaction
    let approvedTransaction = new ApprovedTransaction(atData);

	// let result = await approvedTransaction.save()
	// 	.catch(async e => {
	// 		// return next(new APIError(await sendCallback(merchant.callback, '210'), httpStatus.INTERNAL_SERVER_ERROR, true));
	// 		return res.json(await sendCallback(tl, merchant.callback, '202', '', tl));
	// 	});

	let termins = await HelperFunctions.createTermin(atData);
	atData.termins = termins.termins;
	if(termins.voucher) atData.voucher = termins.voucher;
	preApprovedTransaction.transactionBucket = atData;
	await preApprovedTransaction.save();

	tl.approvedTransactionId = preApprovedTransaction._id;
	let result = preApprovedTransaction.transactionBucket;

	// TRANSACTION FIRST PAYMENT
	// charge user's credit card for first payment
	let flags = {
		found: false,
		isPaid: false,
		nominal: result.termins[0].total + cf.amount,		// --> implementing paying convenience at very first transaction payment
		index: result.termins[0].number,
		token: false,
		termin_id: result.termins[0]._id
	};
	const auth = new Buffer(config.midtrans.server_key + ':' + '').toString('base64');
	// let order_id_creator = `PAYMENT-${result.transactionNumber}-${flags.index}`;
	let order_id_creator = `2-${result.transactionNumber}-${flags.index}`;

	// get card token if client didn't pass token property
	// flags.token = getUserDefaultCard(user);
	// flags.token = preApprovedTransaction.cardToken;
	// if no cards, then throw error
	// if(!flags.token){
	// 	// return next(new APIError(await sendCallback(merchant.callback, '209'), httpStatus.FORBIDDEN, true));
	// 	return res.json(await sendCallback(body, merchant.callback, '209', result._id, tl));
	// }

	result.termins[0].paid.status = true;
	result.termins[0].paid.status_code = '200';
	result.termins[0].paid.date = req.body.jam;
	result.termins[0].method = 'dana';
	result.termins[0].paid.method = 'dana';
	result.termins[0].paid.paymentGateway = 'dana';
	result.termins[0].paid.payment_id = req.body.danaid;

	// change status
	result.status = 1;

	preApprovedTransaction.status = 1;
	preApprovedTransaction.pending = false;

	// updating transaction
	// await result.save();
	await preApprovedTransaction.save();

	// adding convenience fee and termin duration to response
	customFields.terminDuration = result.terminDuration;
	customFields.convenienceFee = result.convenienceFee;

	// adding gross_amount
	customFields.total = result.total;

	// subtracting user's balance
	await User.findOneAndUpdate({_id: user._id}, {$inc: {remainingCredit: -result.total }}, {upsert: true, setDefaultsOnInsert: true})
		.catch(async e => {
			// if failed

			// cancel the transaction from payment gateway
			// await HelperFunctions.requester({
			// 	uri: `${config.midtrans.address}/${order_id_creator}/cancel`,
			// 	method: 'POST',
			// 	headers: {
			// 		Authorization: 'Basic ' + auth,
			// 		'Content-Type': 'application/json'
			// 	}
			// });

			// removing the transaction first
			// await ApprovedTransaction.findByIdAndRemove(result._id);

			// return next(new APIError(await sendCallback(merchant.callback, '210'), httpStatus.FORBIDDEN, true));
			return res.json(await sendCallback(tl, merchant.callback, '210', preApprovedTransaction._id, tl));
		});


	userEmail.push({
		to: user.detail.email,
		subject: 'Transaksi Sukses',
		type: 'successTransactionUser',
		properties: {
			clientName: user.detail.name,
			storeName: merchant.name,
			transactionNumber: transactionNumber,
			createdAt : result.termins[0].paid.date,
			total: numberWithCommas(amount),
			convenienceFee: numberWithCommas(cf.amount)
		}
	});


	// send email of success transaction to merchant
	await TransactionNotification.update({ transactionNumber: preApprovedTransaction.transactionNumber }, {
		approvedTransactionId: result._id,
		merchantEmail: {
			sent: false,
			detail: {
				to: merchant.email,
				subject: 'Transaksi Sukses',
				type: 'successTransactionMerchant',
				properties: {
					name: merchant.name,
					transactionNumber: transactionNumber,
					createdAt : result.termins[0].paid.date,
					amount: amount,
					user: user.mobileNumber
				}
			}
		},
		userEmail: {
			sent: false,
			detail: userEmail
		},
		userPushNotif: {
			sent: false,
			detail: {
				regId: user.regId,
				title: 'Pending Payment',
				body: `Pending payment ${result.transactionNumber} sebesar Rp ${amount} (exc. biaya layaran Rp ${cf.amount})`
			}
		}
	}, { upsert: true });

	// if(merchant.callback){
		// await TransactionNotification.update({approvedTransactionId: result._id}, {
		// 	$set: {
		// 		merchantCallback: {
		// 			sent: false,
		// 			detail: {
		// 				uri: merchant.callback,
		// 				method: 'POST',
		// 				json: HelperFunctions.callbackMakerAdv(tl.transactionNumber, customFields)
		// 			}
		// 		}
		// 	}
		// }, {upsert: true});
	// }
	// send callback if from shopify
	if(preApprovedTransaction.platform === 'shopify'){
		// v1
		// let shopifySignature = '';
		// const currentTime = moment().format('YYYY-MM-DD[T]hh:mm:ss[Z]');

		// shopifySignature += `x_account_id${merchant._id}`;
		// shopifySignature += `x_amount${body.shopify.x_amount}`;
		// shopifySignature += `x_currency${body.shopify.x_currency}`;
		// shopifySignature += `x_gateway_reference${body.shopify.x_reference}`;
		// shopifySignature += `x_reference${body.shopify.x_reference}`;
		// shopifySignature += `x_resultcompleted`;
		// shopifySignature += `x_test${body.shopify.x_test}`;
		// // shopifySignature += `x_timestamp${currentTime}`;
		// shopifySignature += `x_timestamp${body.shopify.x_timestamp}`;
		// shopifySignature = crypto.createHmac('sha256').update(shopifySignature, merchant.secret).digest('hex');

		// v2
		// let shopifySignature = crypto.createHmac('sha256').update(req.body.signatureString, merchant.secret).digest('hex');

		// await TransactionNotification.update({approvedTransactionId: result._id}, {
		// 	$set: {
		// 		merchantCallback: {
		// 			sent: false,
		// 			detail: {
		// 				url: body.x_url_callback,
		// 				qs: {
		// 					x_signature: shopifySignature,
		// 					x_account_id: body.shopify.x_account_id,
		// 					x_amount: body.shopify.x_amount,
		// 					x_currency: body.shopify.x_currency,
		// 					x_gateway_reference: body.shopify.x_reference,
		// 					x_reference: body.shopify.x_reference,
		// 					x_result: 'completed',
		// 					x_test: body.shopify.x_test,
		// 					x_timestamp: body.shopify.x_timestamp
		// 				},
		// 				method: 'POST'
		// 			}
		// 		}
		// 	}
		// }, {upsert: true});

		// v3
		await TransactionNotification.update({transactionNumber: preApprovedTransaction.transactionNumber}, {
			$set: {
				merchantCallback: {
					sent: false,
					detail: preApprovedTransaction.callback,
					response: []
				}
			}
		}, {upsert: true});

	// } else if(merchant.callback && !req.query.shopify){
	} else if(merchant.callback && preApprovedTransaction.platform !== 'shopify'){
		await TransactionNotification.update({transactionNumber: preApprovedTransaction.transactionNumber}, {
			$set: {
				merchantCallback: {
					sent: false,
					detail: {
						uri: merchant.callback,
						method: 'POST',
						json: HelperFunctions.callbackMakerAdv(tl.transactionNumber, customFields)
					},
					response: []
				}
			}
		}, {upsert: true});
	}

	// add to payment log
	let pl = new PaymentLog({
		// status_code: '200',
		// order_id: transactionNumber,
		// transaction_id: req.body.danaid,
		// gross_amount: amount,
		// type: 2,
		user: user._id,
		gatewayType: 'dana',
		transactionId: req.body.danaid,
		order_id: transactionNumber,
		store: result.store,
		type: 2,
		remainingCredit: remainingCredit,
		detail: {
			gross_amount: result.total
		}
	});
	await pl.save()
		.catch(async e => {
			await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {status: 1}});
			return res.json(await sendCallback(tl, '', '200', '', tl));
		});


	// 000000000000000000000000000
	// updating credit
	realAmount -= cf.amount;
	let updateUser = await User.findOneAndUpdate({_id: result.user}, {$inc: {remainingCredit: realAmount }}, {new: true, upsert: true, setDefaultsOnInsert: true});
	const remainingCredit = updateUser.remainingCredit;


	// mailing
	let gross = realAmount + result.convenienceFee;

	// await Mailer.sendMail({
	// 	to: user.detail.email,
	// 	subject: 'Invoice',
	// 	type: 'success',
	// 	properties: {
	// 		name: user.detail.name,
	// 		invoice_id: req.body.txid,
	// 		number: 1,
	// 		date: req.body.jam,
	// 		subTotal: numberWithCommas(realAmount),
	// 		convenienceFee: result.convenienceFee,
	// 		total: numberWithCommas(gross)
	// 	}
	// });


	// write log
	let pld;
	if(result && result.store){
		pld = {
			gatewayType: 'dana',
			transactionId: req.body.danaid,
			store: result.store,
			type: 1,
			remainingCredit: remainingCredit,
			detail: req.body
		};
	} else{
		pld = {
			gatewayType: 'dana',
			transactionId: req.body.danaid,
			type: 1,
			remainingCredit: remainingCredit,
			detail: req.body
		};
	}

	await new UserLog({
		user: result.user,
		status: 2,
		// description: `Pembayaran ke-${orderIdParser(body.order_id)[2]} kamu sebesar Rp ${realAmount} pada ${approvedTransactionDetail.store.name} telah berhasil. Silakan cek email untuk lihat detail invoice.`
		title: 'Pembayaran sukses',
		description: `Tagihan pembayaran ${result.transactionNumber} untuk cicilan ke-1 telah diterima`
	}).save();

	// appending user if user found
	if(result && result.user) pld.user = result.user;

	let paymentLogData = new PaymentLog(pld);
	paymentLogData = await paymentLogData.save()
		.catch(e => {
			return next(new APIError(e, httpStatus.INTERNAL_SERVER_ERROR, true))
		});



	// send push notification
	await notifier({
		regId: user.regId,
		// body: `Pembayaran ke-${orderIdParser(body.order_id)[2]} untuk transaksi ${body.order_id} telah diterima, terima kasih.`
		title: 'Pembayaran sukses',
		body: `Tagihan pembayaran ${result.transactionNumber} untuk cicilan ke-1 telah diterima`
	});
	// 000000000000000000000000000



	// sending socket
	broadcaster('successTransactionWithDana', user.mobileNumber, true, HelperFunctions.callbackMakerAdv(tl.transactionNumber, customFields, remainingCredit));
	// const username = 'empatkali';
	// const password = encodeURIComponent('vH<tV@@E7w.X3cZS');
	// let ws = new WebSocket(`ws://${username}:${password}@127.0.0.1:4041/ws/approvedtransactions/paymentcode/${user.mobileNumber}`);

	// ws.on('open', async function open() {
	// 	ws.send(JSON.stringify({
	// 		success: true,
	// 		type: 'successTransactionWithDana',
	// 		detail: HelperFunctions.callbackMakerAdv(tl.transactionNumber, customFields, remainingCredit)
	// 	}));
	// });

	// send callback to merchant
	// await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {status: 1, pending: false}});
	// record the transaction
	await ApprovedTransaction.create(preApprovedTransaction.transactionBucket);

	// send callback to merchant
	// await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {status: 1, pending: false}});

	// adding reward for referrer
    await HelperFunctions.giveVoucherForFirstTransaction(user);
	
	return res.json(HelperFunctions.callbackMakerAdv(tl.transactionNumber, customFields, remainingCredit, user._id));
}

/**
 * Create approved transaction from gopay transaction
 * @property {string} req.body.user_mobileNumber - The mobile number of the user
 * @property {number} req.body.amount - The amount of approved transaction given by merchant
 * @property {string} req.body.transactionNumber - The transaction number
 */
async function gopayCallback(req, res, next){
	let transactionNumber = req.body.txid.indexOf('-') > -1 ? req.body.txid.split('-')[1] : req.body.txid;
	let tl = {transactionNumber: 'unknown'};
	let body = req.body;
	let customFields = {};
	let realAmount = req.body.jml;

	const preApprovedTransaction = await PreApprovedTransaction.findOne({transactionNumber: transactionNumber});
	if(!preApprovedTransaction || preApprovedTransaction.status === 1 || !preApprovedTransaction.pending) return res.json(await sendCallback(tl, '', '202', '', tl));

    const merchant = await Store.findById(preApprovedTransaction.store)
    	.populate({path: 'merchant', model: Merchant, select: 'convenienceFee prefix'});
    const user = await User.findById(preApprovedTransaction.user);
    const amount = preApprovedTransaction.total;

    // adding custom field
    if(preApprovedTransaction.customFields && !isEmpty(preApprovedTransaction.customFields)){
    	let keys = Object.keys(preApprovedTransaction.customFields);
    	for(let i=0;i<keys.length;i++){
	    	customFields[keys[i]] = preApprovedTransaction.customFields[keys[i]];
	    }
    }

    // set transaction log
    tl.store = preApprovedTransaction.store;
    tl.transactionNumber = preApprovedTransaction.transactionNumber;
    tl.total = preApprovedTransaction.total;
    tl.user = preApprovedTransaction.user;

    // cek if convenience fee has been added
    let cf, cftd = (preApprovedTransaction.terminDuration === 14) ? 'twoWeekly' : 'monthly';
	if(merchant.merchant.convenienceFee){
		if(merchant.merchant.convenienceFee[cftd]){
	    	cf = {amount: merchant.merchant.convenienceFee[cftd]};
	    } else{
	    	if(preApprovedTransaction.terminDuration === 30 || preApprovedTransaction.terminDuration === "30") cf = {amount: 25000};
	    	else cf = {amount: 0};
	    }
	} else{
		if(preApprovedTransaction.terminDuration === 30 || preApprovedTransaction.terminDuration === "30") cf = {amount: 25000};
	    else cf = {amount: 0};
	}

    // ########################################################
    // TRANSACTION FIRST PAYMENT

    let userEmail = [];
    let atData = {
		convenienceFee: cf.amount,
		total: preApprovedTransaction.total,
		transactionNumber: preApprovedTransaction.transactionNumber,
		store: preApprovedTransaction.store,
		user: preApprovedTransaction.user,
		terminDuration: preApprovedTransaction.terminDuration
    };

    // creating new approved transaction
	let termins = await HelperFunctions.createTermin(atData);
	atData.termins = termins.termins;
	if(termins.voucher) atData.voucher = termins.voucher;
	preApprovedTransaction.transactionBucket = atData;
	await preApprovedTransaction.save();

	tl.approvedTransactionId = preApprovedTransaction._id;
	let result = preApprovedTransaction.transactionBucket;

	// TRANSACTION FIRST PAYMENT
	// charge user's credit card for first payment
	let flags = {
		found: false,
		isPaid: false,
		nominal: result.termins[0].total + cf.amount,		// --> implementing paying convenience at very first transaction payment
		index: result.termins[0].number,
		token: false,
		termin_id: result.termins[0]._id
	};
	const auth = new Buffer(config.midtrans.server_key + ':' + '').toString('base64');
	let order_id_creator = `2-${result.transactionNumber}-${flags.index}`;

	result.termins[0].paid.status = true;
	result.termins[0].paid.status_code = '200';
	result.termins[0].paid.date = req.body.jam;
	result.termins[0].method = 'gopay';
	result.termins[0].paid.method = 'gopay';
	result.termins[0].paid.paymentGateway = 'gopay';
	result.termins[0].paid.payment_id = req.body.gopayid;

	// change status
	result.status = 1;

	preApprovedTransaction.status = 1;
	preApprovedTransaction.pending = false;

	// updating transaction
	await preApprovedTransaction.save();

	// adding convenience fee and termin duration to response
	customFields.terminDuration = result.terminDuration;
	customFields.convenienceFee = result.convenienceFee;

	// adding gross_amount
	customFields.total = result.total;

	// subtracting user's balance
	await User.findOneAndUpdate({_id: user._id}, {$inc: {remainingCredit: -result.total }}, {upsert: true, setDefaultsOnInsert: true})
		.catch(async e => {
			return res.json(await sendCallback(tl, merchant.callback, '210', preApprovedTransaction._id, tl));
		});

	userEmail.push({
		to: user.detail.email,
		subject: 'Transaksi Sukses',
		type: 'successTransactionUser',
		properties: {
			clientName: user.detail.name,
			storeName: merchant.name,
			transactionNumber: transactionNumber,
			createdAt : result.termins[0].paid.date,
			total: numberWithCommas(amount),
			convenienceFee: numberWithCommas(cf.amount)
		}
	});

	// send email of success transaction to merchant
	await TransactionNotification.update({ transactionNumber: preApprovedTransaction.transactionNumber }, {
		approvedTransactionId: result._id,
		merchantEmail: {
			sent: false,
			detail: {
				to: merchant.email,
				subject: 'Transaksi Sukses',
				type: 'successTransactionMerchant',
				properties: {
					name: merchant.name,
					transactionNumber: transactionNumber,
					createdAt : result.termins[0].paid.date,
					amount: amount,
					user: user.mobileNumber
				}
			}
		},
		userEmail: {
			sent: false,
			detail: userEmail
		},
		userPushNotif: {
			sent: false,
			detail: {
				regId: user.regId,
				title: 'Pending Payment',
				body: `Pending payment ${result.transactionNumber} sebesar Rp ${amount} (exc. biaya layaran Rp ${cf.amount})`
			}
		}
	}, { upsert: true });

	// send callback if from shopify
	if(preApprovedTransaction.platform === 'shopify'){
		// v3
		await TransactionNotification.update({transactionNumber: preApprovedTransaction.transactionNumber}, {
			$set: {
				merchantCallback: {
					sent: false,
					detail: preApprovedTransaction.callback,
					response: []
				}
			}
		}, {upsert: true});
	} else if(merchant.callback && preApprovedTransaction.platform !== 'shopify'){
		await TransactionNotification.update({transactionNumber: preApprovedTransaction.transactionNumber}, {
			$set: {
				merchantCallback: {
					sent: false,
					detail: {
						uri: merchant.callback,
						method: 'POST',
						json: HelperFunctions.callbackMakerAdv(tl.transactionNumber, customFields)
					},
					response: []
				}
			}
		}, {upsert: true});
	}

	// add to payment log
	let pl = new PaymentLog({
		user: user._id,
		gatewayType: 'gopay',
		transactionId: req.body.gopayid,
		order_id: transactionNumber,
		store: result.store,
		type: 2,
		remainingCredit: remainingCredit,
		detail: {
			gross_amount: result.total
		}
	});

	await pl.save()
		.catch(async e => {
			await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {status: 1}});
			return res.json(await sendCallback(tl, '', '200', '', tl));
		});

	// updating credit
	realAmount -= cf.amount;
	let updateUser = await User.findOneAndUpdate({_id: result.user}, {$inc: {remainingCredit: realAmount }}, {new: true, upsert: true, setDefaultsOnInsert: true});
	const remainingCredit = updateUser.remainingCredit;

	let gross = realAmount + result.convenienceFee;

	// write log
	let pld;
	if(result && result.store){
		pld = {
			gatewayType: 'gopay',
			transactionId: req.body.gopayid,
			store: result.store,
			type: 1,
			remainingCredit: remainingCredit,
			detail: req.body
		};
	} else{
		pld = {
			gatewayType: 'gopay',
			transactionId: req.body.gopayid,
			type: 1,
			remainingCredit: remainingCredit,
			detail: req.body
		};
	}

	await new UserLog({
		user: result.user,
		status: 2,
		title: 'Pembayaran sukses',
		description: `Tagihan pembayaran ${result.transactionNumber} untuk cicilan ke-1 telah diterima`
	}).save();

	// appending user if user found
	if(result && result.user) pld.user = result.user;

	let paymentLogData = new PaymentLog(pld);
	paymentLogData = await paymentLogData.save()
		.catch(e => {
			return next(new APIError(e, httpStatus.INTERNAL_SERVER_ERROR, true))
		});

	// send push notification
	await notifier({
		regId: user.regId,
		title: 'Pembayaran sukses',
		body: `Tagihan pembayaran ${result.transactionNumber} untuk cicilan ke-1 telah diterima`
	});

	// sending socket
	broadcaster('successTransactionWithGopay', user.mobileNumber, true, HelperFunctions.callbackMakerAdv(tl.transactionNumber, customFields, remainingCredit));

	// record the transaction
	await ApprovedTransaction.create(preApprovedTransaction.transactionBucket);

	// adding reward for referrer if first transaction
    await HelperFunctions.giveVoucherForFirstTransaction(user);
	
	return res.json(HelperFunctions.callbackMakerAdv(tl.transactionNumber, customFields, remainingCredit, user._id));
}


/**
 * Create approved transaction
 * @property {string} req.body.user_mobileNumber - The mobile number of the user
 * @property {number} req.body.amount - The amount of approved transaction given by merchant
 * @property {string} req.body.qr - The md5 from the scanned qr code
 * @property {string} req.body.md5 - The md5 which sent from store
 * @property {string} req.body.store - The objectId from the store
 * @property {string} req.body.token - The otp which sent to user's mobileNumber
 * @property {string} req.body.transactionNumber - The transaction number
 *
 * this one will send a callback to the merchant, with status like this:
 * 200 -> success
 * 201 -> OTP not valid
 * 202 -> duplicate invoice number
 * 203 -> insufficient user's balance
 * 204 -> md5 not valid
 * 205 -> user is not allowed
 * 206 -> cannot charge the card
 * 207 -> user not found
 * 208 -> store not found
 * 209 -> card not found
 * 210 -> unexpected error
 * 211 -> Invalid parameter value in the request
 * 212 -> Store is not in active status. Transaction rejected
 * 213 -> Token not valid
 * 214 -> You are not the owner of this mobile number
 * 215 -> Third party error
 */
async function createFromPreApproved(req, res, next){
	const transactionNumber = req.body.transactionNumber;
	let tl = {transactionNumber: 'unknown'};
	let body = req.body;

	let preApprovedTransaction = await PreApprovedTransaction.findOne({transactionNumber: req.body.transactionNumber});
	if(!preApprovedTransaction) return res.json(await sendCallback(body, '', '211', '', tl));

	// adding custom field
    if(preApprovedTransaction.customFields && !isEmpty(preApprovedTransaction.customFields)){
    	let keys = Object.keys(preApprovedTransaction.customFields);
    	for(let i=0;i<keys.length;i++){
	    	body[keys[i]] = preApprovedTransaction.customFields[keys[i]];
	    }
    }

	// check if transaction already succeed
	const checkApprovedTransaction = await ApprovedTransaction.findOne({transactionNumber: transactionNumber});
	if(checkApprovedTransaction){
		body.gross_amount = checkApprovedTransaction.total;
		return res.json(HelperFunctions.callbackMaker(body));
	}

	if(preApprovedTransaction.status === 1) return res.json(await sendCallback(body, '', '200', '', tl, true));

    const merchant = await Store.findById(preApprovedTransaction.store)
    	.populate({path: 'merchant', model: Merchant, select: 'convenienceFee prefix'});
    const user = await User.findById(preApprovedTransaction.user);
    const amount = preApprovedTransaction.total;

    // check if user already input cvv
    if(!preApprovedTransaction.cardToken && preApprovedTransaction.paymentType !== 'dana') return res.json(await sendCallback(body, merchant.callback, '206', '', tl));

    // validate if dana
	if(preApprovedTransaction.paymentType == 'dana' && checkApprovedTransaction) return res.json(HelperFunctions.callbackMaker(body));

    // set transaction log
    tl.store = preApprovedTransaction.store;
    tl.transactionNumber = preApprovedTransaction.transactionNumber;
    tl.total = preApprovedTransaction.total;
    tl.user = preApprovedTransaction.user;

    // cek if convenience fee has been added
    let cf, cftd = (preApprovedTransaction.terminDuration === 14) ? 'twoWeekly' : 'monthly';
	if(merchant.merchant.convenienceFee){
		if(merchant.merchant.convenienceFee[cftd]){
	    	cf = {amount: merchant.merchant.convenienceFee[cftd]};
	    } else{
	    	if(preApprovedTransaction.terminDuration === 30 || preApprovedTransaction.terminDuration === "30") cf = {amount: 25000};
	    	else cf = {amount: 0};
	    }
	} else{
		if(preApprovedTransaction.terminDuration === 30 || preApprovedTransaction.terminDuration === "30") cf = {amount: 25000};
	    else cf = {amount: 0};
	}

    // ########################################################
    // TRANSACTION FIRST PAYMENT

    let userEmail = [];
    let atData = {
    	status: 0,
		convenienceFee: cf.amount,
		total: preApprovedTransaction.total,
		transactionNumber: preApprovedTransaction.transactionNumber,
		store: preApprovedTransaction.store,
		user: preApprovedTransaction.user,
		terminDuration: preApprovedTransaction.terminDuration
    };

    // get voucher code if for zilingo
	if(preApprovedTransaction.zilingo.is){
		const zilingoVoucher = await HelperFunctions.requester({
			// uri: `http://mon.empatkali.co.id/terimalender${(process.env.NODE_ENV === 'production') ? '-prod' : ''}`,
			uri: `http://${(process.env.NODE_ENV === 'development') ? 'sb-' : ''}mon.empatkali.co.id/zilingo/index.php`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			json: {
				nominal: amount
			}
		});

		if(!zilingoVoucher || zilingoVoucher.error || !zilingoVoucher.voc){
			// update failed response to pre approved transaction
            await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {pgResponse: {message: `problem when getting voucher: ${JSON.stringify(zilingoVoucher)}`}}});
			return res.json(await sendCallback(body, merchant.callback, '215', '', tl));
		}

		userEmail.push({
			to: user.detail.email,
			subject: 'Transaksi Sukses [Zilingo]',
			type: 'successTransactionUserZilingo',
			properties: {
				clientName: user.detail.name,
				storeName: merchant.name,
				transactionNumber: transactionNumber,
				total: numberWithCommas(amount),
				convenienceFee: numberWithCommas(cf.amount),
				voucher: zilingoVoucher.voc,
				expire: zilingoVoucher.expire
			}
		});

		atData['zilingo'] = {
			is: true,
			code: zilingoVoucher.voc,
			expire: zilingoVoucher.expire
		}

		atData.transactionNumber = `${merchant.merchant.prefix}.${zilingoVoucher.voc}`;

		body.voucher = zilingoVoucher.voc;
	}

    // creating new approved transaction
 	// let approvedTransaction = new ApprovedTransaction(atData);

	// let result = await approvedTransaction.save()
	// 	.catch(async e => {
	// 		return res.json(await sendCallback(body, merchant.callback, '202', '', tl));
	// 	});
	const termins = await HelperFunctions.createTermin(atData);
	atData.termins = termins.termins;
	if(termins.voucher) atData.voucher = termins.voucher;
	preApprovedTransaction.transactionBucket = atData;
	await preApprovedTransaction.save();

	tl.approvedTransactionId = preApprovedTransaction._id;
	let result = preApprovedTransaction.transactionBucket;

	// TRANSACTION FIRST PAYMENT
	// charge user's credit card for first payment
	let flags = {
		found: false,
		isPaid: false,
		nominal: result.termins[0].total + cf.amount,		// --> implementing paying convenience at very first transaction payment
		index: result.termins[0].number,
		token: false,
		termin_id: result.termins[0]._id
	};
	const auth = new Buffer(config.midtrans.server_key + ':' + '').toString('base64');
	// let order_id_creator = `PAYMENT-${result.transactionNumber}-${flags.index}`;
	let order_id_creator = `2-${result.transactionNumber}-${flags.index}`;

	// get card token if client didn't pass token property
	flags.token = preApprovedTransaction.cardToken;
	// if no cards, then throw error
	if(!flags.token){
		return res.json(await sendCallback(body, merchant.callback, '209', preApprovedTransaction._id, tl));
	}

	// get user defaultcard
	const dc = getUserDefaultCard(user);
	let initCharge;
	let bill = result.total;
	
	if(dc.paymentGateway === 'xendit'){
		// subtraction bill to be updated to users balance
		bill -= result.termins[0].total;

		// initial charge
		initCharge = await HelperFunctions.requester({
			uri: `${config.xendit.address}/credit_card_charges`,
			method: 'POST',
			headers: {
				Authorization: `Basic ${new Buffer(config.xendit.secret_key + ':' + '').toString('base64')}`,
				'Content-Type': 'application/json'
			},
			json: {
				"token_id": dc.token,
				"external_id": order_id_creator,
				"authentication_id": flags.token,
				"amount": flags.nominal
			}
		}).catch(async err => {
			// update failed response to pre approved transaction
            await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {pgResponse: err}});
			
			// removing the transaction first
			// await ApprovedTransaction.findByIdAndRemove(result._id);

			// send push notification to user
			await notifier({
				regId: user.regId,
				title: `Transaksi kamu di ${merchant.name} gagal`,
				body: `Pastikan saldo kartumu cukup untuk membayar 25% pertama dan biaya admin Rp 10.000 sebelum mengulang kembali transaksi`
			});

	    	return res.json(await sendCallback(body, merchant.callback, '206', tl.approvedTransactionId, tl));
	    });
		
		// if cannot charging the card, throw an error
		if(initCharge.status !== 'CAPTURED'){
			// appending pg detail to transactionLog
			tl.detail = initCharge;

			// update failed response to pre approved transaction
            await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {pgResponse: initCharge}});

			// removing the transaction first
			// await ApprovedTransaction.findByIdAndRemove(result._id);

			// send push notification to user
			await notifier({
				regId: user.regId,
				title: `Transaksi kamu di ${merchant.name} gagal`,
				body: `Pastikan saldo kartumu cukup untuk membayar 25% pertama dan biaya admin Rp 10.000 sebelum mengulang kembali transaksi`
			});

			// return res.json(await sendCallback(body, merchant.callback, '206', result._id, tl));
			return res.json(await sendCallback(body, merchant.callback, '206', tl.approvedTransactionId, tl));
		}

		// approvedTransaction.termins[0].paid.status = true;
		result.termins[0].paid.status = true;
		result.termins[0].paid.status_code = '200';
		result.termins[0].paid.date = initCharge.created;
		result.termins[0].paid.method = `${initCharge.card_brand} ${initCharge.card_type}`;
		result.termins[0].paid.payment_id = initCharge.id;
		result.termins[0].paid.paymentGateway = 'xendit';

		// send to /terimalender when it xendit
		await HelperFunctions.requester({
			uri: `http://mon.empatkali.co.id/terimalender${(process.env.NODE_ENV === 'production') ? '-prod' : ''}`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			json: {
				invoice: result.transactionNumber,
				jumlah: result.termins[0].total.toString(),
				ke: 1,
				id: merchant.merchant,
				paymentGateway: 'xendit',
				remainingCredit: user.remainingCredit - result.total + result.termins[0].total,
				userId: result.user,
				terminDuration: result.terminDuration,
				convenienceFee: result.convenienceFee
			}
		});

	} else{
		// charge to midtrans
		initCharge = await HelperFunctions.requester({
			uri: config.midtrans.address + '/charge',
			method: 'POST',
			headers: {
				Authorization: 'Basic ' + auth,
				'Content-Type': 'application/json'
			},
			json: {
				payment_type: 'credit_card',
				transaction_details: {
					order_id: order_id_creator,
					gross_amount: flags.nominal
				},
				credit_card: {
					token_id: flags.token,
					save_token_id: true
				}
			}
		}).catch(async err => {
			// update failed response to pre approved transaction
            await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {pgResponse: err}});
			
			// removing the transaction first
			// await ApprovedTransaction.findByIdAndRemove(result._id);

			// send push notification to user
			await notifier({
				regId: user.regId,
				title: `Transaksi kamu di ${merchant.name} gagal`,
				body: `Pastikan saldo kartumu cukup untuk membayar 25% pertama dan biaya admin Rp 10.000 sebelum mengulang kembali transaksi`
			});
			
	    	return res.json(await sendCallback(body, merchant.callback, '206', tl.approvedTransactionId, tl));
	    });

		// if cannot charging the card, throw an error
		if(initCharge.status_code !== '200'){
			// appending pg detail to transactionLog
			tl.detail = initCharge;

			// update failed response to pre approved transaction
            await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {pgResponse: initCharge}});
			
			// removing the transaction first
			// await ApprovedTransaction.findByIdAndRemove(result._id);

			// send push notification to user
			await notifier({
				regId: user.regId,
				title: `Transaksi kamu di ${merchant.name} gagal`,
				body: `Pastikan saldo kartumu cukup untuk membayar 25% pertama dan biaya admin Rp 10.000 sebelum mengulang kembali transaksi`
			});
			
			// return res.json(await sendCallback(body, merchant.callback, '206', result._id, tl));
			return res.json(await sendCallback(body, merchant.callback, '206', tl.approvedTransactionId, tl));
		}

		// approvedTransaction.termins[0].paid.status = true;
		result.termins[0].paid.status = true;
		result.termins[0].paid.status_code = initCharge.status_code;
		result.termins[0].paid.date = initCharge.transaction_time;
		result.termins[0].paid.method = initCharge.payment_type;
		result.termins[0].paid.payment_id = initCharge.transaction_id;
		result.termins[0].paid.paymentGateway = 'midtrans';
	}

	// change status
	result.status = 1;

	preApprovedTransaction.status = 1;
	preApprovedTransaction.pending = false;
	preApprovedTransaction.pgResponse = initCharge;

	// updating transaction
	// await result.save();
	await preApprovedTransaction.save();

	// subtracting user's balance
	
	const newUserDetail = await User.findOneAndUpdate({_id: user._id}, {$inc: {remainingCredit: -bill }}, {upsert: true, setDefaultsOnInsert: true})
		.catch(async e => {
			// if failed

			// cancel the transaction from payment gateway
			await HelperFunctions.requester({
				uri: `${config.midtrans.address}/${order_id_creator}/cancel`,
				method: 'POST',
				headers: {
					Authorization: 'Basic ' + auth,
					'Content-Type': 'application/json'
				}
			});

			// removing the transaction first
			// await ApprovedTransaction.findByIdAndRemove(result._id);

			// return next(new APIError(await sendCallback(merchant.callback, '210'), httpStatus.FORBIDDEN, true));
			return res.json(await sendCallback(body, merchant.callback, '210', preApprovedTransaction._id, tl));
		});

	userEmail.push({
		to: user.detail.email,
		subject: 'Transaksi Sukses',
		type: 'successTransactionUser',
		properties: {
			clientName: user.detail.name,
			storeName: merchant.name,
			transactionNumber: transactionNumber,
			// createdAt : result.createdAt,
			createdAt: result.termins[0].paid.date,
			total: amount,
			convenienceFee: cf.amount
		}
	});

	// send email of success transaction to merchant
	await TransactionNotification.update({ transactionNumber: preApprovedTransaction.transactionNumber }, {
		// preApprovedTransactionId: preApprovedTransaction._id,
		transactionNumber: preApprovedTransaction.transactionNumber,
		merchantEmail: {
			sent: false,
			detail: {
				to: merchant.email,
				subject: 'Transaksi Sukses',
				type: 'successTransactionMerchant',
				properties: {
					name: merchant.name,
					transactionNumber: transactionNumber,
					createdAt : result.termins[0].paid.date,
					amount: amount,
					user: user.mobileNumber
				}
			}
		},
		userEmail: {
			sent: false,
			detail: userEmail
		},
		userPushNotif: {
			sent: false,
			detail: {
				regId: user.regId,
				title: 'Pending Payment',
				body: `Pending payment ${result.transactionNumber} sebesar Rp ${amount} (exc. biaya layaran Rp ${cf.amount})`
			}
		}
	}, { upsert: true });


	// send callback if from shopify
	if(preApprovedTransaction.platform === 'shopify'){
		// v3
		await TransactionNotification.update({transactionNumber: preApprovedTransaction.transactionNumber}, {
			$set: {
				merchantCallback: {
					sent: false,
					detail: preApprovedTransaction.callback,
					response: []
				}
			}
		}, {upsert: true});


	// } else if(merchant.callback && !req.query.shopify){
	} else if(merchant.callback && preApprovedTransaction.platform !== 'shopify'){
		await TransactionNotification.update({transactionNumber: preApprovedTransaction.transactionNumber}, {
			$set: {
				merchantCallback: {
					sent: false,
					detail: {
						uri: merchant.callback,
						method: 'POST',
						json: HelperFunctions.callbackMaker(body, result.total)
					},
					response: []
				}
			}
		}, {upsert: true});
	}

	// add to payment log
	let pl = new PaymentLog({
		user: user._id,
		gatewayType: 'midtrans',
		transactionId: initCharge.transaction_id,
		order_id: transactionNumber,
		store: result.store,
		type: 2,
		remainingCredit: newUserDetail.remainingCredit,
		detail: {
			gross_amount: result.total
		}
	});
	await pl.save()
		.catch(async e => {
			await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {status: 1, pending: false, pgResponse: initCharge}});
			// return res.json(await sendCallback(body, '', '200', result._id, tl));
		});

	// sending socket
	broadcaster('successTransaction', user.mobileNumber, true, await sendCallback(body, '', '200', result._id, tl));

	// record the transaction
	await ApprovedTransaction.create(preApprovedTransaction.transactionBucket);

	// send callback to merchant
	// await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {status: 1, pending: false, pgResponse: initCharge}});

	// adding reward for referrer
    await HelperFunctions.giveVoucherForFirstTransaction(user);

    // give response
	return res.json(HelperFunctions.callbackMaker(body));
}


/**
 * Create approved transaction
 * @property {string} req.body.user_mobileNumber - The mobile number of the user
 * @property {number} req.body.amount - The amount of approved transaction given by merchant
 * @property {string} req.body.qr - The md5 from the scanned qr code
 * @property {string} req.body.md5 - The md5 which sent from store
 * @property {string} req.body.store - The objectId from the store
 * @property {string} req.body.token - The otp which sent to user's mobileNumber
 * @property {string} req.body.transactionNumber - The transaction number
 */
async function create2(req, res, next){
	const store = req.body.store;
	const userMobileNumber = req.body.user_mobileNumber;
	const amount = req.body.amount || 0;
	const transactionIds = req.body.transactions;
	const tokens = req.body.token;
	const transactionNumber = req.body.transactionNumber;

	let totalTransaction = 0;


	let user = await User.findOne({mobileNumber: userMobileNumber});
	// if user not found from mobileNumber
	if(!user) return next(new APIError('User not found!', httpStatus.NOT_FOUND, true));

	let merchant = await Store.findById(store);
	if(!merchant) return next(new APIError('Store not found!', httpStatus.NOT_FOUND, true));

	let inmd5 = crypto
	    .createHash('md5')
	    .update(`${amount}${transactionNumber}${merchant._id}${merchant.salt}`)
	    .digest('hex');


	if(req.body.qr){
		if(req.body.qr !== inmd5) return next(new APIError('You have wrong md5', httpStatus.FORBIDDEN, true));
	} else{
		const token = speakeasy.totp.verify({
			token: req.body.token,
			secret: user.otp.secret,
			encoding: user.otp.encoding,
			time: user.otp.timestamp
		});

		if(req.body.md5 !== inmd5) return next(new APIError('You have wrong md5', httpStatus.FORBIDDEN, true));
		if(!token) return next(new APIError('Your token is invalid', httpStatus.FORBIDDEN, true));
	}


	// validating if user is passing the transaction ids
	let transactionSearchConditions = {};
	if(transactionIds) transactionSearchConditions = {'_id': { '$in': transactionIds }, 'status': 0};
	else transactionSearchConditions = {user: user._id, status: 0, "store": merchant._id};

	// get the transactions
	const transactions = await Transaction.find(transactionSearchConditions);

	// check if there is no transaction status = 0, or maybe no transaction matched with the ids
	if(transactions.length < 1) return next(new APIError('No Transaction found', httpStatus.UNPROCESSABLE_ENTITY, true));

	// calculating total of the transactions
	if(amount){
		totalTransaction = amount;
	} else{
		for(let i=0;i<transactions.length;i++){
			totalTransaction += transactions[i].total;
		}
	}

	// when total of the transactions is greater than user's remaining credit throw error
	if(totalTransaction > user.remainingCredit) return next(new APIError('Insufficient user credit!', httpStatus.UNPROCESSABLE_ENTITY, true));

	// when total of the transactions is greater than merchant's given credit throw error
	if(totalTransaction > amount) return next(new APIError(`Insufficient merchant\'s given credit. Please select some transactions which less than equals to ${amount}`, httpStatus.UNPROCESSABLE_ENTITY, true));


	// creating transaction Id's array
	let tid = [];
	for(let i=0;i<transactions.length;i++){
		tid.push(transactions[i]._id);
	}

	// check if user is allowed to create transaction
	if(user.status !== 2) return next(new APIError(`User is not allowed to make this transaction.`, httpStatus.UNPROCESSABLE_ENTITY, true));


	// creating new approved transaction
	let approvedTransaction = new ApprovedTransaction({
		transactionNumber: transactionNumber,
		total: totalTransaction,
		transactions: tid,
		store: merchant._id,
		user: user._id
	});

	let result = await approvedTransaction.save();


	// TRANSACTION FIRST PAYMENT
	// charge user's credit card for first payment
	let flags = {
		found: false,
		isPaid: false,
		nominal: result.termins[0].total,
		index: result.termins[0].number,
		token: false,
		termin_id: result.termins[0]._id
	};
	const auth = new Buffer(config.midtrans.server_key + ':' + '').toString('base64');
	// let order_id_creator = `PAYMENT-${result.transactionNumber}-${flags.index}`;
	let order_id_creator = `2-${result.transactionNumber}-${flags.index}`;
	
	// get card token if client didn't pass token property
	flags.token = getUserDefaultCard(user);
	// if no cards, then throw error
	if(!flags.token){
		return next(new APIError(`No card found`, httpStatus.FORBIDDEN, true));
	}
	
	// charge to midtrans
	let initCharge = await HelperFunctions.requester({
		uri: config.midtrans.address + '/charge',
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + auth,
			'Content-Type': 'application/json'
		},
		json: {
			payment_type: 'credit_card',
			transaction_details: {
				order_id: order_id_creator,
				gross_amount: flags.nominal
			},
			credit_card: {
				token_id: flags.token,
				save_token_id: true
			}
		}
	});

	// if cannot charging the card, throw an error
	if(initCharge.status_code !== '200' && initCharge.status_code !== '201'){
		const errs = new APIError('Cannot charge the card. Transaction declined', httpStatus.INTERNAL_SERVER_ERROR, true);
		return next(errs);
	}

	result.termins[0].paid.status = true;
	result.termins[0].paid.status_code = initCharge.status_code;
	result.termins[0].paid.date = initCharge.transaction_time;
	result.termins[0].paid.method = initCharge.payment_type;
	result.termins[0].paid.payment_id = initCharge.transaction_id;

	// change status
	result.status = 1;

	// updating transaction
	await result.save();


	// subtracting user's balance
	await User.findOneAndUpdate({_id: user._id}, {$inc: {remainingCredit: -result.total }}, {upsert: true, setDefaultsOnInsert: true});

	// update transaction status
	await Transaction.update({ _id: { $in: result.transactions } }, {$set: {status: 1}}, {multi: true});


	// Push Notification
	await notifier({
		regId: user.regId,
		title: 'Pending Payment',
		body: `Pending payment ${result.transactionNumber} sebesar Rp ${totalTransaction}`
	});

	// send email to merchant
	// await Mailer.sendMail({
	// 	to: merchant.email,
	// 	subject: subject,
	// 	type: type,
	// 	properties: {
	// 		host: `${host}/api/users/verification/email?mn=${userData.mobileNumber}&ac=${token}&as=${secret.base32}`
	// 	}
	// })


	return res.json({message: 'Transaction success'});

}

/**
 * Check Callback
 * returns {status: Boolean}
 */
async function checkCallback(req, res, next){
	const preApprovedTransaction = await PreApprovedTransaction.findOne({transactionNumber: req.params.transactionNumber}).select('redirectURL');
	const approvedTransaction = await ApprovedTransaction.findOne({transactionNumber: req.params.transactionNumber}).select('_id');
	if(!approvedTransaction || !preApprovedTransaction) return next(new APIError('No transaction found', httpStatus.UNPROCESSABLE_ENTITY, true));
	const transactionNotification = await TransactionNotification.findOne({transactionNumber: req.params.transactionNumber});
	if(!transactionNotification) return next(new APIError('No transaction notification found', httpStatus.UNPROCESSABLE_ENTITY, true));

	return res.json({
		sent: transactionNotification.merchantCallback.sent,
		redirectURL: preApprovedTransaction.redirectURL
	});
}

/**
 * Update failed transaction notification
 */
async function updateFailedTransactionNotification(req, res, next){
	const { transactionNumber = '' } = req.params;
	// let failedTransaction = await FailedTransactionNotification.findOne({transactionNumber: transactionNumber});

	// if(!failedTransaction) return next(new APIError('No data found', httpStatus.INTERNAL_SERVER_ERROR, true));

	// return res.json(await FailedTransactionNotification.findByIdAndUpdate(failedTransaction._id, {$set: {'merchantCallback.sent': true}}, {new: true}));
	// return res.json(await PreApprovedTransaction.findOneAndUpdate({transactionNumber: transactionNumber}, {$set: {status: 2}}, {new: true}));
	return res.json({
		message: 'Done'
	});
}

/**
 * Testing
 */
async function testing(req, res, next){
	const a = await requester({
		// timeout: 1500,
		uri: 'http://127.0.0.1:4041/api/pgchecker',
		method: 'GET',
		json: {
			provider: 'xendit'
		}
	});

	return res.json(a);
}


/**
 *  Helper functions
 */
function numberWithCommas(q){
	q = parseInt(q);
	return q.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

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

function notifier(datas){
	return new Promise((resolve, reject) => {
		try{
			let payload = {
				notification: {
					title: datas.title,
					body: datas.body,
					sound : "default"
				},
				priority: "high",
				to: datas.regId
			}

			const opt = {
				url: config.firebase.host,
				json: payload,
				headers: {
					Authorization: `key=${config.firebase.key}`,
					'Content-Type': 'application/json'
				},
				method: 'POST'
			};

			HelperFunctions.requester(opt)
			  .then(resp => {
			  	if(resp.success === 1){
			  		return resolve(true);
			  	} else{
			  		return resolve(false);
			  	}
			  })
			  .catch((err) => {
				const errs = new APIError('No such merchant exists', httpStatus.NOT_FOUND, true);
				return reject(errs);
			  });

		} catch(e){
			return reject(new APIError('Failed sending notification', httpStatus.INTERNAL_SERVER_ERROR, true));
		}

	});
}

function getItemsTotalPrice(td){
	let transactionTotal = 0;
    for(let i=0;i<td.length;i++){
    	transactionTotal += td[i].price * td[i].quantity;
    }

    return transactionTotal;
}

function getUserDefaultCard(user){
	let result = false;
	let cards = user.card;

	for(let i=0;i<cards.length;i++){
		if(cards[i].defaultCard){
			result = cards[i];
			break;
		}
	}

	return result;
}


/*
 * 200 -> success
 * 201 -> OTP not valid
 * 202 -> duplicate invoice number
 * 203 -> insufficient user's balance
 * 204 -> md5 not valid
 * 205 -> user is not allowed
 * 206 -> cannot charge the card
 * 207 -> user not found
 * 208 -> store not found
 * 209 -> card not found
 * 210 -> unexpected error
 * 211 -> Invalid parameter value in the request
 * 212 -> Store is not in active status. Transaction rejected
 * 213 -> Token not valid
 * 214 -> You are not the owner of this mobile number
 * 215 -> Third party error
 */
async function sendCallback(body, url, status, tid, log, reRequest){
	let callbackMessage = {
		transaction_id: body.transactionNumber,
		transaction_number: (body.transactionNumber.indexOf('.') > -1) ? body.transactionNumber.substring(body.transactionNumber.indexOf('.')+1, body.transactionNumber.length) : body.transactionNumber,
		success: false,
		status_code: status,
		status_message: 'unexpected error'
	};

	switch(status){
		case '200':
			callbackMessage.success = true;
			callbackMessage.status_message = 'success';
			break;
		case '201':
			callbackMessage.status_message = 'OTP not valid';
			break;
		case '202':
			callbackMessage.status_message = 'duplicate invoice number';
			break;
		case '203':
			callbackMessage.status_message = 'insufficient user\'s balance';
			break;
		case '204':
			callbackMessage.status_message = 'md5 not valid';
			break;
		case '205':
			callbackMessage.status_message = 'user is not allowed';
			break;
		case '206':
			callbackMessage.status_message = 'cannot charge the card';
			break;
		case '207':
			callbackMessage.status_message = 'user not found';
			break;
		case '208':
			callbackMessage.status_message = 'store not found';
			break;
		case '209':
			callbackMessage.status_message = 'card not found';
			break;
		case '211':
			callbackMessage.status_message = 'Invalid parameter value in the request';
			break;
		case '212':
			callbackMessage.status_message = 'Store is not in active status. Transaction rejected';
			break;
		case '213':
			callbackMessage.status_message = 'Token not valid';
			break;
		case '214':
			callbackMessage.status_message = 'You are not the owner of this mobile number';
			break;
		case '215':
			callbackMessage.status_message = 'Third party error';
			break;
		default:
			callbackMessage.status_message = 'unexpected error';
	}

	// send callback
	// if(url && url !== '' && status === '200'){
	// 	await TransactionNotification.update({approvedTransactionId: tid}, {
	// 		approvedTransactionId: tid,
	// 		merchantCallback: {
	// 			sent: false,
	// 			detail: {
	// 				uri: url,
	// 				method: 'POST',
	// 				json: addingCustomField(body, callbackMessage)
	// 			}
	// 		}
	// 	}, {upsert: true});
	// }

	// adding log
	if(reRequest){
		log.status_code = status;
		await new TransactionLog(log).save();
	}

	// if(status !== '200'){
	// 	const pat = await PreApprovedTransaction.findOne({transactionNumber: body.transactionNumber});

	// 	if(pat.failedURL){
	// 		await FailedTransactionNotification.create({
	// 		transactionNumber: body.transactionNumber,
	// 			merchantCallback: {
	// 				sent: false,
	// 				detail: {
	// 					uri: pat.failedURL,
	// 					method: 'POST',
	// 					json: callbackMessage
	// 				},
	// 				response: []
	// 			}
	// 		});
	// 	}
	// }

	return addingCustomField(body, callbackMessage);
}


async function sendCallbackLite(body, status){
	let callbackMessage = {
		transaction_id: body.transactionNumber,
		transaction_number: (body.transactionNumber.indexOf('.') > -1) ? body.transactionNumber.substring(body.transactionNumber.indexOf('.')+1, body.transactionNumber.length) : body.transactionNumber,
		success: false,
		status_code: status,
		status_message: 'unexpected error'
	};

	switch(status){
		case '200':
			callbackMessage.success = true;
			callbackMessage.status_message = 'success';
			break;
		case '201':
			callbackMessage.status_message = 'OTP not valid';
			break;
		case '202':
			callbackMessage.status_message = 'duplicate invoice number';
			break;
		case '203':
			callbackMessage.status_message = 'insufficient user\'s balance';
			break;
		case '204':
			callbackMessage.status_message = 'md5 not valid';
			break;
		case '205':
			callbackMessage.status_message = 'user is not allowed';
			break;
		case '206':
			callbackMessage.status_message = 'cannot charge the card';
			break;
		case '207':
			callbackMessage.status_message = 'user not found';
			break;
		case '208':
			callbackMessage.status_message = 'store not found';
			break;
		case '209':
			callbackMessage.status_message = 'card not found';
			break;
		case '211':
			callbackMessage.status_message = 'Invalid parameter value in the request';
			break;
		case '212':
			callbackMessage.status_message = 'Store is not in active status. Transaction rejected';
			break;
		case '213':
			callbackMessage.status_message = 'Token not valid';
			break;
		case '214':
			callbackMessage.status_message = 'You are not the owner of this mobile number';
			break;
		default:
			callbackMessage.status_message = 'unexpected error';
	}

	return addingCustomField(body, callbackMessage);
}


function addingCustomField(body, datas){
	let bucket = datas;
	let store, userMobileNumber, amount, tokens, transactionNumber, md5, tn;

	if(body.qr){
		let qrAssets = body.qr;
		qrAssets = qrAssets.split('|');

		if(qrAssets.length > 4){
			let tmp, counter = 0;

			// parsing here
			try{
				
				for(let i=4;i<qrAssets.length;i++){
					if(counter < 5){
						tmp = qrAssets[i];
						tmp = tmp.split(':');
						bucket[tmp[0]] = tmp[1];

						++counter;
					}
				}

				return bucket;
			} catch(e){
				return bucket;
			}

		}

	} else if(body.md5){
		let keys = Object.keys(body);

		if(keys.length > 6){
			let counter = 0;
			
			for(let i=0;i<keys.length;i++){
				if(counter < 5){
					if(keys[i] !== 'transactionNumber' && keys[i] !== 'total' && keys[i] !== 'amount' && keys[i] !== 'store' && keys[i] !== 'md5' && keys[i] !== 'token'){
						bucket[keys[i]] = body[keys[i]];
						++counter;
					}
				}
			}
		}
	}


	return bucket;
}

function isEmpty(obj) {
  for(var prop in obj) {
    if(obj.hasOwnProperty(prop)) {
      return false;
    }
  }

  return JSON.stringify(obj) === JSON.stringify({});
}

function callbackMaker(body, total){
  let bucket = {
    transaction_id: body.transactionNumber,
    transaction_number: (body.transactionNumber.indexOf('.') > -1) ? body.transactionNumber.substring(body.transactionNumber.indexOf('.')+1, body.transactionNumber.length) : body.transactionNumber,
    success: true,
    status_code: '200',
    status_message: 'success'
  };

  if(total) bucket.gross_amount = total;

  let keys = Object.keys(body);

	let counter = 0;
	
	for(let i=0;i<keys.length;i++){
		if(counter < 5){
			if(keys[i] !== 'transactionNumber' && keys[i] !== 'total' && keys[i] !== 'amount' && keys[i] !== 'store' && keys[i] !== 'md5' && keys[i] !== 'token'){
				bucket[keys[i]] = body[keys[i]];
				++counter;
			}
		}
	}

	return bucket;
}

function callbackMakerAdv(transactionNumber, body, remainingCredit, userId){
  let bucket = {
    transaction_id: transactionNumber,
    transaction_number: (transactionNumber.indexOf('.') > -1) ? transactionNumber.substring(transactionNumber.indexOf('.')+1, transactionNumber.length) : transactionNumber,
    success: true,
    status_code: '200',
    status_message: 'success'
  };

  if(remainingCredit) bucket.remainingCredit = remainingCredit;
  if(userId) bucket.userId = userId;
  if(body.total) bucket.gross_amount = body.total;

  let keys = Object.keys(body);

	let counter = 0;
	
	for(let i=0;i<keys.length;i++){
		if(counter < 5){
			if(keys[i] !== 'transactionNumber' && keys[i] !== 'total' && keys[i] !== 'amount' && keys[i] !== 'store' && keys[i] !== 'md5' && keys[i] !== 'token'){
				bucket[keys[i]] = body[keys[i]];
				++counter;
			}
		}
	}

	return bucket;
}

async function broadcaster(type, mn, success, detail){
	const username = 'empatkali';
	const password = encodeURIComponent('vH<tV@@E7w.X3cZS');
	const ws = new WebSocket(`ws://${username}:${password}@127.0.0.1:4041/ws/approvedtransactions/paymentcode/${mn}`);

	ws.on('open', async function open() {
		let getCVV = {
			type: type,
			success: success,
			detail: detail
		};
		return setTimeout(async ()=>{
			ws.send(JSON.stringify(getCVV));
		}, 1000);
		
	});
}




module.exports = {
	list, 
	load, 
	getByMerchant,
	init,
	approve,
	generateQR,
	create,
	create2,
	generateQRJWTLess,
	createFromPreApproved,
	listForPlugin,
	danaCallback,
	gopayCallback,
	checkCallback,
	updateFailedTransactionNotification,
	testing
};
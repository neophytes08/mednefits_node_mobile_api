// async await handlers is express.js
require('express-async-errors');

const path = require('path');
const Promise = require('bluebird');
const crypto = require('crypto');
const ApprovedTransaction = require('../approvedTransaction/approved-transaction.model');
const PreApprovedTransaction = require('./preapproved-transaction.model');
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
const mongoose = require('mongoose');
const request = require('request');
const async = require('async');
const speakeasy = require('speakeasy');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const moment = require('moment');
const HelperFunctions = require('../../helpers/functions');
const qs = require('querystring');
const ipRangeCheck = require('ip-range-check');


/**
 * Load preApprovedTransaction and append to req.
 */
async function load(req, res, next, id) {
	req.preApprovedTransactions = await PreApprovedTransaction.get(id); // eslint-disable-line no-param-reassign
	return next();
}

/**
 * Load preApprovedTransaction and append to req.
 */
async function loadTransactionNumber(req, res, next, id) {
	req.preApprovedTransactions = await PreApprovedTransaction.findOne({transactionNumber: id}); // eslint-disable-line no-param-reassign
	return next();
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

	const transactions = await PreApprovedTransaction.find(searchConditions);
	return res.send(transactions);
}

/**
 * Create initial Pre Approved Transaction from internal IP
 */
async function initInternal(req, res, next){
	let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  	ip = ip.substr(7);

	if (!ipRangeCheck(ip, config.internalAddress.split(','))){
		return next(new APIError('you are not allowed to do this', httpStatus.FORBIDDEN, true));
	}

	let store, userMobileNumber, amount, transactionNumber, tn;

	let merchant = await Store.findById(req.body.store)
		.populate({path: 'merchant', model: Merchant, select: 'convenienceFee zilingo prefix name'})
		.catch(async e => {
			// broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '208'));
			return res.status(200).json(await sendCallbackLite(req.body, '208')).end();
		});

	// check store
	if(!merchant){
		// broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '208'));
		return res.json(await sendCallbackLite(req.body, '208'));
	}
	if(!merchant.active){
		// broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '218'));
		return res.json(await sendCallbackLite(req.body, '212'));
	}

	// create custom transaction number
	// transactionNumber = `${merchant.name.substr(0, 5).toUpperCase()}.${transactionNumber.replace(/-/g, '|')}`;
	if(merchant.merchant.prefix){
		transactionNumber = `${merchant.merchant.prefix}.${req.body.transactionNumber.replace(/[^\w\s]/gi, '')}`
	} else{
		// transactionNumber = `${merchant.name.substr(0, 5).toUpperCase()}.${transactionNumber.replace(/-/g, '|')}`;
		let prefix = prefixMaker(merchant.merchant.name);

		let accepted = false;

	    // if merchant did not have prefix
	    while(!accepted) {
			if(await Merchant.count({prefix: prefix}) < 1){
				// update prefix to merchant
				await Merchant.findByIdAndUpdate(merchant.merchant._id, {$set: {prefix: prefix}});
				accepted = true;
			} else{
				prefix = prefixMaker(merchant.merchant.name, true);
			}
	    }

		transactionNumber = `${prefix}.${req.body.transactionNumber.replace(/[^\w\s]/gi, '')}`
	}

	let dataToSend = {
		store: req.body.store,
		orderId: req.body.transactionNumber,
		transactionNumber: transactionNumber,
		reminder: {
			email: null,
			name: null,
			sent: false
		}
	};

	if(req.body.checkoutEmail) dataToSend.reminder.email = req.body.checkoutEmail;
	if(req.body.checkoutName) dataToSend.reminder.name = req.body.checkoutName;
	if(req.body.otherFields) dataToSend.otherFields = req.body.otherFields;

	// check if preapproved exists
	const pa = await PreApprovedTransaction.findOne({transactionNumber: transactionNumber});

	if(pa){
		if(!pa.hasOwnProperty('status')) dataToSend.status = 0;
		if(!pa.hasOwnProperty('pending')) dataToSend.pending = true;
	} else{
		dataToSend.status = 0;
		dataToSend.pending = true;
	}

	await PreApprovedTransaction.update(
		{
			transactionNumber: transactionNumber
		}, dataToSend, {upsert: true}
	);

	return res.json(await sendCallbackLite(req.body, '200'));
}

/**
 * Create initial Pre Approved Transaction 
 */
async function init(req, res, next){
	let store, userMobileNumber, amount, tokens, transactionNumber, md5, tn;
	let tl = {transactionNumber: 'unknown'};

	if(req.body.qr){
		let qrAssets = req.body.qr;
		qrAssets = qrAssets.split('|');

		if(qrAssets.length < 4 || !req.body.token) return res.json(await sendCallbackLite(tl, '211'));

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
				if(!decodedToken.dataToken.mobileNumber) return res.json(await sendCallbackLite(tl, '213'));

				userMobileNumber = tl.user_mobileNumber = decodedToken.dataToken.mobileNumber;
			} else{
				return res.json(await sendCallbackLite(tl, '213'));
			}

		} catch(e){
			return res.json(await sendCallbackLite(tl, '213'));
		}


	} else if(req.body.md5){
		// if(!req.body.store || !req.body.user_mobileNumber || !req.body.amount || !req.body.token || !req.body.transactionNumber) return res.json(await sendCallbackLite(tl, '211'));
		if(!req.body.store || !req.body.amount || !req.body.transactionNumber) return res.json(await sendCallbackLite(tl, '211'));

		store = req.body.store;
		// userMobileNumber = req.body.user_mobileNumber.trim();
		amount = req.body.amount || 0;
		transactionNumber = req.body.transactionNumber; tn = req.body.transactionNumber;

		// set transaction log
		tl.store = store;
		tl.transactionNumber = transactionNumber;
		tl.total = amount;
		// tl.userMobileNumber = req.body.user_mobileNumber.trim();

	} else if(req.query.shopify){
		// if(!req.body.shopify || !req.body.shopify.x_signature || !req.body.shopify.x_url_callback || !req.body.shopify.signatureString || !req.body.shopify.x_account_id || !req.body.shopify.x_reference || !req.body.shopify.x_amount || !req.body.shopify.shopifySignature || !req.body.shopify.x_url_complete) return res.json(await sendCallbackLite(tl, '211'));
		if(!req.body.shopify || !req.body.shopify.x_signature || !req.body.shopify.x_url_callback || !req.body.shopify.x_account_id || !req.body.shopify.x_reference || !req.body.shopify.x_amount || !req.body.shopify.x_url_complete) return res.json(await sendCallbackLite(tl, '211'));

		store = req.body.shopify.x_account_id;
		// userMobileNumber = req.body.user_mobileNumber.trim();
		amount = req.body.shopify.x_amount || 0;
		transactionNumber = req.body.shopify.x_reference; tn = req.body.shopify.x_reference;

		// set transaction log
		tl.store = store;
		tl.transactionNumber = transactionNumber;
		tl.total = amount;
		// tl.userMobileNumber = req.body.user_mobileNumber.trim();
	} else{
		return res.json(await sendCallbackLite(tl, '211'));
	}

	let merchant = await Store.findById(store)
		.populate({path: 'merchant', model: Merchant, select: 'convenienceFee zilingo prefix name'})
		.catch(async e => {
			// broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '208'));
			return res.status(200).json(await sendCallbackLite(tl, '208')).end();
		});

	// check store
	if(!merchant){
		// broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '208'));
		return res.json(await sendCallbackLite(tl, '208'));
	}
	if(!merchant.active){
		// broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '218'));
		return res.json(await sendCallbackLite(tl, '212'));
	}

	// create custom transaction number
	// transactionNumber = `${merchant.name.substr(0, 5).toUpperCase()}.${transactionNumber.replace(/-/g, '|')}`;
	if(merchant.merchant.prefix){
		transactionNumber = `${merchant.merchant.prefix}.${transactionNumber.replace(/[^\w\s]/gi, '')}`
	} else{
		// transactionNumber = `${merchant.name.substr(0, 5).toUpperCase()}.${transactionNumber.replace(/-/g, '|')}`;
		let prefix = prefixMaker(merchant.merchant.name);

		let accepted = false;

	    // if merchant did not have prefix
	    while(!accepted) {
			if(await Merchant.count({prefix: prefix}) < 1){
				// update prefix to merchant
				await Merchant.findByIdAndUpdate(merchant.merchant._id, {$set: {prefix: prefix}});
				accepted = true;
			} else{
				prefix = prefixMaker(merchant.merchant.name, true);
			}
	    }

		transactionNumber = `${prefix}.${transactionNumber.replace(/[^\w\s]/gi, '')}`
	}

	// let user = await User.findOne({mobileNumber: userMobileNumber})
	//  .catch(async e => {
	//  	broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '207'));
	//  	return res.status(200).json(await sendCallbackLite(tl, '207')).end();
	//  });
	// // if user not found from mobileNumber
	// if(!user){
	// 	broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '207'));
	// 	return res.json(await sendCallbackLite(tl, '207'));
	// }

	let dataToSend = {
		store: store,
		transactionNumber: transactionNumber,
		total: amount,
		reminder: {
			email: null,
			sent: false
		}
	};

	if(req.body.checkoutEmail) dataToSend.reminder.email = req.body.checkoutEmail;
	if(req.body.checkoutName) dataToSend.reminder.name = req.body.checkoutName;
	if(req.body.otherFields) dataToSend.otherFields = req.body.otherFields;

	// check if preapproved exists
	const pa = await PreApprovedTransaction.findOne({transactionNumber: transactionNumber});

	if(pa){
		if(!pa.hasOwnProperty('status')) dataToSend.status = 0;
		if(!pa.hasOwnProperty('pending')) dataToSend.pending = true;
	} else{
		dataToSend.status = 0;
		dataToSend.pending = true;
	}

	await PreApprovedTransaction.update(
		{
			transactionNumber: transactionNumber
		}, dataToSend, {upsert: true}
	);

	return res.json(await sendCallbackLite(tl, '200'));
}

/**
 * Create pre approved transaction
 */
async function create(req, res, next){
	let store, userMobileNumber, amount, tokens, transactionNumber, md5, tn;
	let tl = {transactionNumber: 'unknown'};

	if(req.body.qr){
		let qrAssets = req.body.qr;
		qrAssets = qrAssets.split('|');

		if(qrAssets.length < 4 || !req.body.token) return res.json(await sendCallbackLite(tl, '211'));

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
				if(!decodedToken.dataToken.mobileNumber) return res.json(await sendCallbackLite(tl, '213'));

				userMobileNumber = tl.user_mobileNumber = decodedToken.dataToken.mobileNumber;
			} else{
				return res.json(await sendCallbackLite(tl, '213'));
			}

		} catch(e){
			return res.json(await sendCallbackLite(tl, '213'));
		}


	} else if(req.body.md5){
		if(!req.body.store || !req.body.user_mobileNumber || !req.body.amount || !req.body.token || !req.body.transactionNumber) return res.json(await sendCallbackLite(tl, '211'));

		store = req.body.store;
		userMobileNumber = req.body.user_mobileNumber.trim();
		amount = req.body.amount || 0;
		tokens = req.body.token.trim();
		transactionNumber = req.body.transactionNumber; tn = req.body.transactionNumber;

		// set transaction log
		tl.store = store;
		tl.transactionNumber = transactionNumber;
		tl.total = amount;
		tl.userMobileNumber = req.body.user_mobileNumber.trim();

	} else if(req.query.shopify){
		// if(!req.body.shopify || !req.body.shopify.x_signature || !req.body.shopify.x_url_callback || !req.body.shopify.signatureString || !req.body.shopify.x_account_id || !req.body.shopify.x_reference || !req.body.shopify.x_amount || !req.body.shopify.shopifySignature || !req.body.shopify.x_url_complete) return res.json(await sendCallbackLite(tl, '211'));
		if(!req.body.shopify || !req.body.shopify.x_signature || !req.body.shopify.x_url_callback || !req.body.shopify.x_account_id || !req.body.shopify.x_reference || !req.body.shopify.x_amount || !req.body.shopify.x_url_complete || !req.body.token) return res.json(await sendCallbackLite(tl, '211'));

		store = req.body.shopify.x_account_id;
		userMobileNumber = req.body.user_mobileNumber.trim();
		amount = req.body.shopify.x_amount || 0;
		tokens = req.body.token.trim();
		transactionNumber = req.body.shopify.x_reference; tn = req.body.shopify.x_reference;

		// set transaction log
		tl.store = store;
		tl.transactionNumber = transactionNumber;
		tl.total = amount;
		tl.userMobileNumber = req.body.user_mobileNumber.trim();
	} else{
		return res.json(await sendCallbackLite(tl, '211'));
	}

	let merchant = await Store.findById(store)
		.populate({path: 'merchant', model: Merchant, select: 'convenienceFee zilingo prefix name'})
		.catch(async e => {
			broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '208'));
			return res.status(200).json(await sendCallbackLite(tl, '208')).end();
		});

	// check store
	if(!merchant){
		broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '208'));
		return res.json(await sendCallbackLite(tl, '208'));
	}
	if(!merchant.active){
		broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '218'));
		return res.json(await sendCallbackLite(tl, '212'));
	}

	// create custom transaction number
	// transactionNumber = `${merchant.name.substr(0, 5).toUpperCase()}.${transactionNumber.replace(/-/g, '|')}`;
	if(merchant.merchant.prefix){
		transactionNumber = `${merchant.merchant.prefix}.${transactionNumber.replace(/[^\w\s]/gi, '')}`
	} else{
		// transactionNumber = `${merchant.name.substr(0, 5).toUpperCase()}.${transactionNumber.replace(/-/g, '|')}`;
		let prefix = prefixMaker(merchant.merchant.name);

		let accepted = false;

	    // if merchant did not have prefix
	    while(!accepted) {
			if(await Merchant.count({prefix: prefix}) < 1){
				// update prefix to merchant
				await Merchant.findByIdAndUpdate(merchant.merchant._id, {$set: {prefix: prefix}});
				accepted = true;
			} else{
				prefix = prefixMaker(merchant.merchant.name, true);
			}
	    }

		transactionNumber = `${prefix}.${transactionNumber.replace(/[^\w\s]/gi, '')}`
	}

	let user = await User.findOne({mobileNumber: userMobileNumber})
	 .catch(async e => {
	 	broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '207'));
	 	return res.status(200).json(await sendCallbackLite(tl, '207')).end();
	 });
	// if user not found from mobileNumber
	if(!user){
		broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '207'));
		return res.json(await sendCallbackLite(tl, '207'));
	}

	const paCounter = await PreApprovedTransaction.count({transactionNumber: transactionNumber});
	if(paCounter < 1){
		await PreApprovedTransaction.update(
			{
				transactionNumber: transactionNumber
			}, {
				transactionNumber: transactionNumber,
				total: amount,
				user: user._id,
				store: merchant._id,
				customFields: getCustomField(req.body),
				zilingo: {
					is: false
				}
			}, {upsert: true}
		);
	}

	// cek if convenience fee has been added
	let cf = await Fee.findOne({type: 'convenience'});
	if(!cf) cf = {amount: 0};

	// adding user to transactionLog
	tl.user = user._id;

	let inmd5 = crypto
	    .createHash('md5')
	    .update(`${amount}${tl.transactionNumber}${merchant._id}${merchant.salt}`)
	    .digest('hex');


	// if in development, pass this validation
	// if(process.env.NODE_ENV === 'production'){
		if(req.body.qr){
			if(md5 !== inmd5){
				broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '204'));
				return res.json(await sendCallbackLite(tl, '204'));
			}

		} else if(req.query.shopify){
			// validating token
			const token = speakeasy.totp.verify({
				token: req.body.token.trim(),
				secret: user.otp.secret,
				digits: user.otp.digits,
				encoding: user.otp.encoding,
				time: user.otp.timestamp
			});

			if(!token){
				broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '201'));
				return res.json(await sendCallbackLite(tl, '201'));
			}

			// validating shopify
			let signatureString = '';
			Object.keys(req.body.shopify)
		      .sort()
		      .forEach(function(v, i) {
		      	  if(v !== 'x_signature' && v !== 'x_gateway_reference' && v !== 'x_result' && v !== 'x_timestamp') signatureString += `${v}${req.body.shopify[v]}`;
		       });

		    signatureString = signatureString.replace(/\+/g, ' ');

			const signatureHash = crypto.createHmac('sha256', merchant.salt).update(signatureString).digest('hex');
			if(signatureHash.toString() !== req.body.shopify.x_signature){
				broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '204'));
				return res.json(await sendCallbackLite(tl, '204'));
			}
		} else{
			const token = speakeasy.totp.verify({
				token: req.body.token.trim(),
				secret: user.otp.secret,
				digits: user.otp.digits,
				encoding: user.otp.encoding,
				time: user.otp.timestamp
			});
			
			if(req.body.md5 !== inmd5){
				broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '204'));
				return res.json(await sendCallbackLite(tl, '204'));
			}
			if(!token){
				broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '201'));
				return res.json(await sendCallbackLite(tl, '201'));
			}
		}
	// }

	// when total of the transactions is greater than user's remaining credit throw error
	if(amount > user.remainingCredit){
		broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '203'));
		return res.json(await sendCallbackLite(tl, '203'));
	}

	// check if user is allowed to create transaction
	if(user.status !== 2){
		broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '205'));
		return res.json(await sendCallbackLite(tl, '205'));
	}

	req.body.transactionNumber = transactionNumber;
	tl.transactionNumber = transactionNumber;

	// check if transactionNumber exists or not
	const getTransaction = await PreApprovedTransaction.findOne({transactionNumber: transactionNumber});
	if(getTransaction){
		if(getTransaction.status == 2) return res.json(await sendCallbackLite(tl, '216'));
		if(!getTransaction.pending) return res.json(await sendCallbackLite(tl, '202'));
	}

	const dc = getUserDefaultCard(user);
	let userPaymentGateway = '';

	let paData = {
		transactionNumber: transactionNumber,
		total: amount,
		user: user._id,
		store: merchant._id,
		customFields: getCustomField(req.body),
		zilingo: {
			is: false
		}
	};
	if(user.defaultPayment === 'dana' && user.danaVerifiedAccount){
		paData.paymentType = 'dana';
		userPaymentGateway = 'dana';
	} else if(user.defaultPayment === 'card'){
		paData.paymentType = 'card';
		userPaymentGateway = dc.paymentGateway;
	} else if(user.defaultPayment === 'gopay'){
		paData.paymentType = 'gopay';
		userPaymentGateway = 'gopay';
	} else{
		broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '215'));
		return res.json(await sendCallbackLite(tl, '215'));
	}

	// let preApprovedTransaction = new PreApprovedTransaction(paData);

	if(req.query.shopify){
		// const shopifySignatureString = `x_account_id=${req.body.shopify.x_account_id}&x_amount=${req.body.shopify.x_amount}&x_currenty=${req.body.shopify.x_currenty}&x_gateway_reference=${req.body.shopify.x_reference}&x_reference=${req.body.shopify.x_reference}&x_result=completed&x_test=${req.body.shopify.x_test}&x_timestamp=${decodeURIComponent(req.body.shopify.x_timestamp)}`;
		let shopifySignatureObject = decodeURIComponent(qs.stringify({
			x_account_id: req.body.shopify.x_account_id,
			x_amount: req.body.shopify.x_amount,
			x_currency: req.body.shopify.x_currency,
			x_gateway_reference: req.body.shopify.x_reference,
			x_reference: req.body.shopify.x_reference,
			x_result: 'completed',
			x_test: req.body.shopify.x_test,
			x_timestamp: req.body.shopify.x_timestamp
		}));
		shopifySignatureObject = shopifySignatureObject.replace(/&/g, "");
		shopifySignatureObject = shopifySignatureObject.replace(/=/g, "");

		const shopifySignature = crypto.createHmac('sha256', merchant.salt).update(shopifySignatureObject).digest('hex');

		paData.platform = 'shopify';
		paData.redirectURL = req.body.shopify.x_url_complete;
		// paData.callback = {
		// 	uri: req.body.shopify.x_url_callback,
		// 	json: {
		// 		x_signature: shopifySignature,
		// 		x_account_id: req.body.shopify.x_account_id,
		// 		x_amount: req.body.shopify.x_amount,
		// 		x_currency: req.body.shopify.x_currency,
		// 		x_gateway_reference: req.body.shopify.x_reference,
		// 		x_reference: req.body.shopify.x_reference,
		// 		x_result: 'completed',
		// 		x_test: req.body.shopify.x_test,
		// 		x_timestamp: req.body.shopify.x_timestamp
		// 	},
		// 	method: 'POST'
		// };

		const shopifyJSON = {
			x_signature: shopifySignature,
			x_account_id: req.body.shopify.x_account_id,
			x_amount: req.body.shopify.x_amount,
			x_currency: req.body.shopify.x_currency,
			x_gateway_reference: req.body.shopify.x_reference,
			x_reference: req.body.shopify.x_reference,
			x_result: 'completed',
			x_test: req.body.shopify.x_test,
			x_timestamp: req.body.shopify.x_timestamp
		};

		paData.callback = {
			uri: req.body.shopify.x_url_callback,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: qs.stringify(shopifyJSON)
		};

		paData.property = req.body.shopify;
	}

	// adding zilingo feature
	// if(req.query.zilingo) paData.zilingo.is = true;
	if(merchant.merchant.zilingo) paData.zilingo.is = true;

	// adding termin duration
	if(merchant.defaultTerminDuration){
		paData.terminDuration = merchant.defaultTerminDuration;
	} else{
		paData.terminDuration = req.body.terminDuration || 14;
	}

	if(req.body.failedURL) paData.failedURL = req.body.failedURL;

	// check if preapproved exists
	const pa = await PreApprovedTransaction.findOne({transactionNumber: transactionNumber});

	if(pa){
		if(!pa.hasOwnProperty('status')) paData.status = 0;
		if(!pa.hasOwnProperty('pending')) paData.pending = true;
	} else{
		paData.status = 0;
		paData.pending = true;
	}
	
	try{
		// let result = await preApprovedTransaction.save();
		let result = await PreApprovedTransaction.update({transactionNumber: transactionNumber}, paData, {upsert: true});

		if(req.query.store) broadcaster(userMobileNumber, true, {transactionNumber: transactionNumber, gross_amount: Math.round(amount / 4), store: true, paymentType: paData.paymentType});
		else broadcaster(userMobileNumber, true, {transactionNumber: transactionNumber, gross_amount: Math.round(amount / 4), paymentType: paData.paymentType});

		// send callback to merchant
		return res.json(await sendCallbackLite(tl, '200', userPaymentGateway));
	} catch(e){
		broadcaster(userMobileNumber, false, await sendCallbackLite(tl, '202'));
		return res.json(await sendCallbackLite(tl, '202'));
	}
}


/**
 * Injecting new card token
 */
async function updateCardToken(req, res, next){
	const preApprovedTransaction = await PreApprovedTransaction.findOne({transactionNumber: req.body.transactionNumber});
	const store = await Store.findOne({
		_id: req.body.storeId,
		// salt: req.body.secret
	}).populate({path: 'merchant', model: Merchant, select: 'convenienceFee'});
	const user = await User.findOne({_id: preApprovedTransaction.user}).select('mobileNumber danaVerifiedAccount defaultPayment');

	if(!preApprovedTransaction) return next(new APIError('No transaction found', httpStatus.INTERNAL_SERVER_ERROR, true));
	if(!store && (!preApprovedTransaction.store && (preApprovedTransaction.store.toString() !== req.body.storeId.toString() ))) return next(new APIError('You are not allowed here', httpStatus.FORBIDDEN, true));
	if(preApprovedTransaction.store.toString() !== req.body.storeId.toString()) return next(new APIError('You are not the owner of the transaction', httpStatus.FORBIDDEN, true));

	let passed = false;

	// let cf = await Fee.findOne({type: 'convenience'});
	let cf, cftd = (preApprovedTransaction.terminDuration === 14) ? 'twoWeekly' : 'monthly';
	if(store.merchant.convenienceFee){
		if(store.merchant.convenienceFee[cftd]){
	    	cf = {amount: store.merchant.convenienceFee[cftd]};
	    } else{
	    	if(preApprovedTransaction.terminDuration === 30 || preApprovedTransaction.terminDuration === "30") cf = {amount: 25000};
	    	else cf = {amount: 0};
	    }
	} else{
		if(preApprovedTransaction.terminDuration === 30 || preApprovedTransaction.terminDuration === "30") cf = {amount: 25000};
	    else cf = {amount: 0};
	}

    // determining which default payment method is used by user
    // DANA
	if(user.defaultPayment === 'dana'){
		let cardTokenz = await HelperFunctions.requester({
			url: `http://149.129.252.24/dana/createorder${(process.env.NODE_ENV === 'production') ? '-prod' : ''}.php`,
			qs: {
				trxid: `2-${preApprovedTransaction.transactionNumber}-1`,
				jml: Math.round(preApprovedTransaction.total / 4) + cf.amount,
				hp: user.mobileNumber,
				redirect: req.body.redirectUrl ? req.body.redirectUrl : 'https://empatkali.co.id'
			},
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		});

		const cardToken = JSON.parse(cardTokenz);
		let tokenResponse = {
			redirect_url: cardToken.url
		};
		tokenResponse.paymentType = 'dana';

		return res.json({
			redirect_url: cardToken.url,
			payment_method: 'dana'
		});

	// GOPAY
	} else if(user.defaultPayment === 'gopay'){
		let cardTokenz = await HelperFunctions.requester({
			url: `http://${(process.env.NODE_ENV === 'production') ? '' : 'sb-'}gopay.empatkali.co.id/charge.php`,
			json: {
				hp: user.mobileNumber,
				amount: Math.round(preApprovedTransaction.total / 4) + cf.amount,
				invoice: `2-${preApprovedTransaction.transactionNumber}-1`
			},
			method: 'POST'
		});

		let chargeURL = '';
		if(cardTokenz.hasOwnProperty('actions')){
		// 	if(Array.isArray(cardToken.actions)) chargeURL = cardToken.actions[chargeURL.actions.length].url;
		// 	else chargeURL = cardToken.actions.url;
			chargeURL = cardTokenz.actions[cardTokenz.actions.length].url;
		}

		let tokenResponse = {
			redirect_url: chargeURL
		};
		tokenResponse.paymentType = 'gopay';

		return res.json({
			redirect_url: chargeURL,
			payment_method: 'gopay'
		});

	// CARD
	} else{

		const userCards = await User.findById(preApprovedTransaction.user).select('card');
		const dc = getUserDefaultCard(userCards);
		let cardToken;

		if(dc.paymentGateway === 'xendit'){
			let cardTokenz = await HelperFunctions.requester({
				url: `${config.xendit.address}/credit_card_tokens/${dc.token}/authentications`,
				method: 'POST',
				json: {
					"amount": Math.round(preApprovedTransaction.total / 4) + cf.amount
				},
				headers: {
					Authorization: `Basic ${new Buffer(config.xendit.public_key + ':' + '').toString('base64')}`,
					'Content-Type': 'application/json'
				}
			});

			cardToken = {
				"status_code": "200",
				"status_message": "Credit card token is created as Token ID.",
				"token_id": cardTokenz.id,
				"bank": dc.bank,
				"hash": dc.masked,
				"redirect_url": cardTokenz.payer_authentication_url
			};
		} else{
			if(!req.body.card_cvv) new APIError('default card cvv is required', httpStatus.INTERNAL_SERVER_ERROR, true)

			let cardTokenz = await HelperFunctions.requester({
				url: config.midtrans.address + '/token',
				qs: {
					client_key: config.midtrans.client_key,
					gross_amount: Math.round(preApprovedTransaction.total / 4) + cf.amount,
					card_cvv: req.body.card_cvv,
					token_id: dc.token,
					secure: true
				},
				method: 'GET',
				headers: {
					Authorization: `Basic ${new Buffer(config.midtrans.server_key + ':' + '').toString('base64')}`,
					'Content-Type': 'application/json'
				}
			});

			cardToken = JSON.parse(cardTokenz);
		}

		cardToken.paymentType = 'card';
		cardToken.paymentGateway = dc.paymentGateway;

		if(cardToken.status_code === '200'){
			await PreApprovedTransaction.findOneAndUpdate({transactionNumber: req.body.transactionNumber}, {$set: {cardToken: cardToken.token_id}});
			return res.send(cardToken);
		} else{
			return next(new APIError('Failed in creating card token', httpStatus.INTERNAL_SERVER_ERROR, true));
		}

		// if(!req.body.card_cvv) return next(new APIError('Card CVV is required', httpStatus.INTERNAL_SERVER_ERROR, true));

		// const userCards = await User.findById(preApprovedTransaction.user).select('card');
		// const dc = getUserDefaultCard(userCards);
		// let cardTokenz = await HelperFunctions.requester({
		// 	url: config.midtrans.address + '/token',
		// 	qs: {
		// 		client_key: config.midtrans.client_key,
		// 		gross_amount: Math.round(preApprovedTransaction.total / 4) + cf.amount,
		// 		card_cvv: req.body.card_cvv,
		// 		token_id: dc,
		// 		secure: true
		// 	},
		// 	method: 'GET',
		// 	headers: {
		// 		Authorization: `Basic ${new Buffer(config.midtrans.server_key + ':' + '').toString('base64')}`,
		// 		'Content-Type': 'application/json'
		// 	}
		// });

		// let cardToken = JSON.parse(cardTokenz);
		// cardToken.paymentType = 'card';

		// if(cardToken.status_code === '200'){
		// 	await PreApprovedTransaction.findOneAndUpdate({transactionNumber: req.body.transactionNumber}, {$set: {cardToken: cardToken.token_id}});
		// 	// return res.send({message: 'success updating token'});
		// 	return res.send(cardToken);
		// } else{
		// 	return next(new APIError('Failed in creating card token', httpStatus.INTERNAL_SERVER_ERROR, true));
		// }
	}
}

/**
 * Injecting new card token
 */
async function getUserDefaultCardDetail(req, res, next){
	const preApprovedTransaction = req.preApprovedTransactions;
	const store = await Store.findOne({
		_id: req.body.storeId,
		// salt: req.body.secret
	});

	if(!store && (!preApprovedTransaction.store && (preApprovedTransaction.store.toString() !== req.body.storeId.toString() ))) return next(new APIError('You are not allowed here', httpStatus.FORBIDDEN, true));

	const user = await User.findById(preApprovedTransaction.user).select('card');
	const cards = user.card;
	let result = false;
	result = cards.find(card => card.defaultCard);

	if(result){
		result.token = undefined;
		result.defaultCard = undefined;
		result._id = undefined;
		return res.json(result);
	} else{
		return next(new APIError('No default card found', httpStatus.INTERNAL_SERVER_ERROR, true));
	}
}



/**
 *  Helper functions
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
			// result = cards[i].token;
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
 * 215 -> No payment method found
 */
async function sendCallback(body, url, status, tid, log){
	let callbackMessage = {
		transaction_id: body.transactionNumber,
		success: false,
		status_code: status,
		status_message: 'unexpected error'
	};

	if(body.transactionNumber) callbackMessage.transaction_number = (body.transactionNumber.indexOf('.') > -1) ? body.transactionNumber.substring(body.transactionNumber.indexOf('.')+1, body.transactionNumber.length) : body.transactionNumber;

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
			callbackMessage.status_message = 'No payment method found';
			break;
		default:
			callbackMessage.status_message = 'unexpected error';
	}

	// send callback
	if(url && url !== '' && status === '200'){
		await TransactionNotification.update({approvedTransactionId: tid}, {
			approvedTransactionId: tid,
			merchantCallback: {
				sent: false,
				detail: {
					uri: url,
					method: 'POST',
					json: addingCustomField(body, callbackMessage)
				}
			}
		}, {upsert: true});
	}

	// adding log
	log.status_code = status;
	await new TransactionLog(log).save();

	return addingCustomField(body, callbackMessage);
}


async function sendCallbackLite(body, status, pg){
	let callbackMessage = {
		transaction_id: body.transactionNumber,
		success: false,
		status_code: status,
		status_message: 'unexpected error',
		paymentGateway: pg
	};

	if(pg) callbackMessage.paymentGateway = pg;

	if(body.transactionNumber) callbackMessage.transaction_number = (body.transactionNumber.indexOf('.') > -1) ? body.transactionNumber.substring(body.transactionNumber.indexOf('.')+1, body.transactionNumber.length) : body.transactionNumber;

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
			callbackMessage.status_message = 'No payment method found';
			break;
		case '216':
			callbackMessage.status_message = 'Transaction is expired, please create a new one';
			break;
		default:
			callbackMessage.status_message = 'unexpected error';
	}

	return addingCustomField(body, callbackMessage);
}

function getCustomField(body){
	let bucket = {};
	let store, userMobileNumber, amount, tokens, transactionNumber, md5, tn;

	if(body.qr){
		let qrAssets = body.qr;
		qrAssets = qrAssets.split('|');

		if(qrAssets.length > 4){
			let tmp, counter = 0;

			// parsing here
			try{
				
				for(let i=4;i<qrAssets.length;i++){
					if(counter < 6){
						tmp = qrAssets[i];
						tmp = tmp.split(':');
						console.log(tmp[0]);
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
					if(keys[i] !== 'transactionNumber' && keys[i] !== 'amount' && keys[i] !== 'store' && keys[i] !== 'md5' && keys[i] !== 'token' && keys[i] !== 'secret' && keys[i] !== 'checkoutEmail'){
						bucket[keys[i]] = body[keys[i]];
						++counter;
					}
				}
			}
		}
	}


	return bucket;
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
					if(keys[i] !== 'transactionNumber' && keys[i] !== 'amount' && keys[i] !== 'store' && keys[i] !== 'md5' && keys[i] !== 'token'){
						bucket[keys[i]] = body[keys[i]];
						++counter;
					}
				}
			}
		}
	}


	return bucket;
}

async function broadcaster(mn, success, detail){
	const username = 'empatkali';
	const password = encodeURIComponent('vH<tV@@E7w.X3cZS');
	const ws = new WebSocket(`ws://${username}:${password}@127.0.0.1:4041/ws/approvedtransactions/paymentcode/${mn}`);

	ws.on('open', async function open() {
		let getCVV = {
			type: 'doneInit',
			success: success,
			detail: detail
		};
		return setTimeout(async ()=>{
			ws.send(JSON.stringify(getCVV));
		}, 2500);
		
	});
}

function prefixMaker(p, exists){
  let result = '';
  const prefix = p.split(' ').join('');
  
  if(exists){
  	result += prefix.substr(0, 2).toUpperCase();
  	result += makeUniqueString(3).toUpperCase();
  } else{
  	result += prefix.substr(0, 5).toUpperCase();
  	if(prefix.length < 5) result += makeUniqueString(5-prefix.length).toUpperCase();
  }

  return result;
}

function makeUniqueString(length){
  let result           = '';
  const characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const charactersLength = characters.length;
  for ( var i = 0; i < length; i++ ) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}




module.exports = {
	list,
	load,
	loadTransactionNumber,
	create,
	updateCardToken,
	getUserDefaultCardDetail,
	init,
	initInternal
};
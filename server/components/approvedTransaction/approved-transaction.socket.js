// async await handlers is express.js
require('express-async-errors');

const express = require('express');
const Promise = require('bluebird');
const Merchant = require('../merchant/merchant.model');
const ApprovedTransaction = require('./approved-transaction.model');
const PaymentLog = require('../paymentLog/payment-log.model');
const TransactionNotification = require('../transactionNotification/transaction-notification.model');
const User = require('../user/user.model');
const PreApprovedTransaction = require('../preApprovedTransaction/preapproved-transaction.model');
const TransactionLog = require('../transactionLog/transaction-log.model');
const Store = require('../store/store.model');
const httpStatus = require('http-status');
const Fee = require('../fee/fee.model');
const APIError = require('../../helpers/APIError');
const config = require('../../../config/config');
const mongoose = require('mongoose');
const request = require('request');
const async = require('async');
const * as _ = require('lodash');
const jwt = require('jsonwebtoken');
const ews = require('express-ws');
const moment = require('moment');
const speakeasy = require('speakeasy');
const HelperFunctions = require('../../helpers/functions');
const FailedTransactionNotification = require('../failedTransaction/failed-transaction.model');

ews(express());

const router = express.Router(); // eslint-disable-line new-cap

String.prototype.equals = (that) => {
    return this === that;
}

router.ws('/test', (ws,req) => {
  // console.log("socket from client")
  // console.log(JSON.stringify(ws))
  // var aWss = expressWs.getWss('/');
  ws.on('message',(msg) => {
    // var x = req.wss.getWss('/chat').clients;
    // console.log(`clients: ${JSON.stringify(x)}`);
  //  ws.getWss().clients.forEach(function (client) {
    // client.send('hello');
    ws.send('back from node');
  // });
  })
});

var chatrooms = {};
router.ws('/room/:name', (ws, req) => {
  var name = req.params.name;
  var room = chatrooms[name] || {
    connections: []
  };
  var index = room.connections.push(ws) - 1;
  chatrooms[name] = room;

  ws.on('message', (msg) => {
    // console.log(`room member: ${JSON.stringify(room)}`);
    room.connections.forEach((conn) => {
      if (conn === ws) return;
      conn.send(msg);
    });
  });

  ws.on('close', () => {
    // room.connections.splice(index, 1);
    console.log(`a client on index-${index} has been disconnected`);
    ws.close();
  });
});





let getToken = {};
router.ws('/gettoken/:user', async (ws, req) => {
  const userIdentity = req.params.user;
  let conditions = {}, looper;

  let room = getToken[userIdentity] || {
    connections: []
  };

  if(/^08\d[0-9]{7,9}$/g.test(userIdentity)) conditions.mobileNumber = userIdentity;
  else conditions._id = userIdentity;

  // create the socket unique identifier
  ws.id = require('crypto').randomBytes(16).toString('base64');


  let user = await User.findOne(conditions).select('_id otp');

  if(user){
    room.connections.push({
      value: ws,
      _id: ws.id
    });
    
    getToken[userIdentity] = room;


    // start generating token
    ws.on('message', async (msg) => {
      if(getToken[userIdentity].connections.length === 1){
        let tokens = OTPCreator();

        room.connections.forEach(async (conn) => {
          user.otp.secret = tokens.secret.base32;
          user.otp.timestamp = tokens.timestamps;
          user.otp.encoding = tokens.encoding;
          await user.save();

          conn.value.send(tokens.otp);
        });

        looper = setInterval(() => {
          tokens = OTPCreator();

          room.connections.forEach(async (conn) => {
            user.otp.secret = tokens.secret.base32;
            user.otp.timestamp = tokens.timestamps;
            user.otp.encoding = tokens.encoding;
            await user.save();

            conn.value.send(tokens.otp);
          });
        }, 30000);
      } else{
        ws.send('someone is already connected. you can\'t get the otp');
      }
    });

  }

  ws.on('close', () => {
    clearInterval(looper);
    // delete getToken[userIdentity];
    for(let i=0;i<room.connections.length;i++){
      if(room.connections[i]._id === ws.id) room.connections.splice(i, 1);
    }

    console.log(`an audience has been disconnected`);
    ws.close();
  });

});







let initRooms = {};
router.ws('/init/:transactionId', (ws, req) => {
  const name = req.params.transactionId;
  const type = req.query.t;
  const _id = req.query.id;

  let room = initRooms[name] || {
    connections: []
  };

  let secret = speakeasy.generateSecret();
  let token = speakeasy.totp({
    secret: secret.base32,
    encoding: 'base32',
    time: timeCreator()
    // window: 10,
    // step: 10,
    // digits: 4
  });


  // check if request is valid
  if(dbChecker(type, _id)){
    room.connections.push({
      value: ws,
      type: type
    });
    
    initRooms[name] = room;
  }

  ws.on('message', (msg) => {

    // check if user and store is already in room
    if(checkRoomReady(room.connections)){
      const datas = JSON.parse(msg);
      let fromStore = false;

      // validate if message is coming from store
      room.connections.forEach((conn) => {
        if(conn.value === ws && conn.type === 'store') fromStore = true;
      });

      // if message is coming from store, then broadcast the pin, secret and other token value
      // and also setInterval to 30 seconds, for refreshing the pin
      if(fromStore){
        let tokens = OTPCreator();

        room.connections.forEach((conn) => {
          if(conn.type === 'store'){
            let d = { secret: tokens.secret.base32, timestamps: tokens.timestamps, epoch: 30 }
            conn.value.send(JSON.stringify(d));
          } else{
            let d = { otp: tokens.otp }
            conn.value.send(JSON.stringify(d));
          }
        });

        let looper = setInterval(() => {
          tokens = OTPCreator();

          room.connections.forEach((conn) => {
            if(conn.type === 'store'){
              let d = { secret: tokens.secret.base32, timestamps: tokens.timestamps }
              conn.value.send(JSON.stringify(d));
            } else{
              let d = { otp: tokens.otp }
              conn.value.send(JSON.stringify(d));
            }
          });
        }, 30000);
      }
    }
  });

  ws.on('close', () => {
    clearInterval(looper);
    console.log(`an audience has been disconnected`);
    ws.close();
  });

});



let initOnlineRooms = {};
router.ws('/init/online/:transactionId', async (ws, req) => {
  const name = req.params.transactionId;
  const type = req.query.t;
  const _id = req.query.id;
  let looper;

  let room = initOnlineRooms[name] || {
    connections: []
  };

  // get approved transaction
  let approvedTransaction = await ApprovedTransaction.findOne({transactionNumber: name});

  // check if request is valid
  if(dbChecker(type, _id)){
    room.connections.push({
      value: ws,
      type: type
    });
    
    initOnlineRooms[name] = room;
  }

  ws.on('message', async (msg) => {
    if(approvedTransaction && dbChecker(type, _id)){

      const datas = JSON.parse(msg);
      // get otp assets
      let tokens = OTPCreator();


      if(room.connections.length > 0){
        room.connections.forEach(async (conn) => {
          // updating token asset to database
          approvedTransaction.otp.secret = tokens.secret.base32;
          approvedTransaction.otp.timestamp = tokens.timestamps;
          approvedTransaction.otp.encoding = tokens.encoding;
          await approvedTransaction.save();

          // sending token to user
          let d = { otp: tokens.otp };
          conn.value.send(JSON.stringify(d));
        });

        looper = setInterval(() => {
          tokens = OTPCreator();

          room.connections.forEach(async (conn) => {

            // updating token asset to database
            approvedTransaction.otp.secret = tokens.secret.base32;
            approvedTransaction.otp.timestamp = tokens.timestamps;
            approvedTransaction.otp.encoding = tokens.encoding;
            await approvedTransaction.save();

            // sending token to user
            let d = { otp: tokens.otp };
            conn.value.send(JSON.stringify(d));
          });
        }, 30000);


      }

    } else{
      let d = { message: 'you are not allowed here' };
      ws.send(JSON.stringify(d));
    }

  });

  ws.on('close', () => {
    clearInterval(looper);
    console.log(`an audience has been disconnected`);
    ws.close();
  });

});


let storeRooms = {};
router.ws('/store/:storeId', async (ws, req) => {
  // ws.on('message', async (msg) => {
  //   ws.send(msg);
  //   console.log(msg);
  // });
  var name = req.params.storeId;
  var room = storeRooms[name] || {
    connections: []
  };
  var index = room.connections.push(ws) - 1;
  storeRooms[name] = room;

  ws.on('request', (a) => {
    console.log('a client connected');
  });

  ws.on('message', (msg) => {
    room.connections.forEach((conn) => {
      if(conn !== ws) conn.send(msg);
    });
  });

  ws.on('close', () => {
    room.connections.splice(index, 1);
    console.log(`a client has been disconnected`);
    ws.close();
  });
});





let paymentCodeRooms = {};
router.ws('/paymentcode/:user_mobileNumber', async (ws, req) => {
  const socketId = require('crypto').randomBytes(16).toString('base64');
  const name = req.params.user_mobileNumber;
  let conditions = {mobileNumber: name}, looper;
  let room = paymentCodeRooms[name] || {
    connections: []
  };
  let clientType = '';
  let requestFlag = '';

  ws.on('request', function(a){
    console.log('a client connected');
  });

  // create the socket unique identifier
  ws.id = socketId;

  const userCards = await User.findOne(conditions).select('card');
  let user = await User.findOne(conditions).select('_id otp detail regId defaultPayment danaVerifiedAccount remainingCredit referrer');

  // start generating token
  ws.on('message', async (msg) => {
    let message = JSON.parse(msg);
    console.log(JSON.stringify(message));
    switch(message.type){
      case 'validateClient':
        /**
         * message
         * {
         *    type: 'validateClient',
         *    token: <user_jwt>, OR store: {id: <String>, secret: <String>}
         *    clientType: <String Enum['user', 'store']>
         * }
         */

        if((message.token || message.store) && message.clientType){
          let passed = false;

          // room = paymentCodeRooms[socketId] || {
          //   connections: []
          // };

          if(message.clientType === 'user'){
            try{
              const decodedToken = jwt.verify(message.token, config.userJwtSecret);

              if(decodedToken.dataToken){
                if(decodedToken.dataToken.mobileNumber && decodedToken.dataToken.mobileNumber === name) passed = true;
              }
            } catch(e){
              return ws.send(JSON.stringify(responseMaker(false, 'validateClient', {message: 'you\'re not allowed here'})));
            }

          } else{
            for(let i=0;i<room.connections.length;i++){
              if(room.connections[i].type.toLowerCase() !== 'user'){
                room.connections.splice(i, 1);
                break;
              }
            }
            const store = await Store.findOne({
              _id: message.store.id,
              // salt: message.store.secret
            });

            if(store) passed = true;
          }

          if(passed){
            room.connections.push({
              value: ws,
              _id: ws.id,
              type: message.clientType
            });
            
            paymentCodeRooms[name] = room;

            return ws.send(JSON.stringify(responseMaker(true, 'validateClient', {message: 'success connecting'})));
          } else{
            return ws.send(JSON.stringify(responseMaker(false, 'validateClient', {message: 'you\'re not allowed here'})));
          }

        } else{
          return ws.send(JSON.stringify(responseMaker(false, 'validateClient', {message: 'one or more parameter(s) not found'})));
        }

        break;

      case 'paymentPin':
        /**
         * message
         * {
         *    type: 'initPayment',
         *    token: <user_jwt>,
         *    on: Boolean         --> this one is optional, if you didnt pass this then the server will turn off payment log looping
         * }
         */
        const decodedToken = jwt.verify(message.token, config.userJwtSecret);
        let isActive = false;

        if(decodedToken.dataToken){
          if(!decodedToken.dataToken.mobileNumber){
            return ws.send(JSON.stringify(responseMaker(false, 'paymentPin', {message: 'you\'re not allowed here'})));
          } else{
            clearInterval(looper);
            if(message.on && !isActive){
              isActive = true;
              let tokens = OTPCreator();

              user.otp.secret = tokens.secret.base32;
              user.otp.timestamp = tokens.timestamps;
              user.otp.encoding = tokens.encoding;
              user.otp.digits = tokens.digits;
              await user.save();

              ws.send(JSON.stringify(responseMaker(true, 'paymentPin', {otp: tokens.otp, expiredIn: tokens.delay})));

              looper = setInterval(async (x) => {
                tokens = OTPCreator();

                user.otp.secret = tokens.secret.base32;
                user.otp.timestamp = tokens.timestamps;
                user.otp.encoding = tokens.encoding;
                user.otp.digits = tokens.digits;
                await user.save();

                ws.send(JSON.stringify(responseMaker(true, 'paymentPin', {otp: tokens.otp, expiredIn: tokens.delay})));
              }, 30000);
            } else{
              isActive = false;
              clearInterval(looper);
            }
          }

        } else{
          return ws.send(JSON.stringify(responseMaker(false, 'paymentPin', {message: 'one or more parameter(s) not found'})));
        }
        break;

      case 'createPayment':
        /**
         * message
         * {
         *    type: 'createPayment',
         *    transactionNumber: <TransactionNumber>,
         *    cardToken: <String>
         * }
         */

        let body = {transactionNumber: 'unknown'};
        let tl = {transactionNumber: 'unknown'};

        if(requestFlag !== message.transactionNumber){
          // try{
            requestFlag = message.transactionNumber;

            if(message.transactionNumber && message.cardToken){


              // PreApprovedTransaction
              let preApprovedTransaction = await PreApprovedTransaction.findOne({transactionNumber: message.transactionNumber});
              const merchant = await Store.findById(preApprovedTransaction.store)
                .populate({path: 'merchant', model: Merchant, select: 'convenienceFee prefix'});

              body = {transactionNumber: preApprovedTransaction.transactionNumber};

              // adding custom field
              if(preApprovedTransaction.customFields && !isEmpty(preApprovedTransaction.customFields)){
                let keys = Object.keys(preApprovedTransaction.customFields);
                for(let i=0;i<keys.length;i++){
                  body[keys[i]] = preApprovedTransaction.customFields[keys[i]];
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
                    nominal: preApprovedTransaction.total
                  }
                });

                if(!zilingoVoucher || zilingoVoucher.error || !zilingoVoucher.voc){
                  // update failed response to pre approved transaction
                  await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {pgResponse: {message: `problem when getting voucher: ${JSON.stringify(zilingoVoucher)}`}}});
                  room.connections.forEach(async (conn) => {
                    conn.value.send(JSON.stringify(responseMaker(false, 'createPayment', await sendCallback(body, merchant.callback, '215', '', tl))));
                  });
                  return;
                }

                userEmail.push({
                  to: user.detail.email,
                  subject: 'Transaksi Sukses [Zilingo]',
                  type: 'successTransactionUserZilingo',
                  properties: {
                    clientName: user.detail.name,
                    storeName: merchant.name,
                    transactionNumber: preApprovedTransaction.transactionNumber,
                    createdAt : preApprovedTransaction.createdAt,
                    total: preApprovedTransaction.total,
                    convenienceFee: cf.amount,
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
              //   .catch(async e => {
              //     room.connections.forEach(async (conn) => {
              //       conn.value.send(JSON.stringify(responseMaker(false, 'createPayment', await sendCallback(body, merchant.callback, '202', '', tl))));
              //     });
              //     return;
              //   });
              const termins = await HelperFunctions.createTermin(atData);
              atData.termins = termins.termins;
              preApprovedTransaction.transactionBucket = atData;
              if(termins.voucher) atData.voucher = termins.voucher;
              await preApprovedTransaction.save();

              let result = preApprovedTransaction.transactionBucket;

              // TRANSACTION FIRST PAYMENT
              // charge user's credit card for first payment
              let flags = {
                found: false,
                isPaid: false,
                nominal: result.termins[0].total + cf.amount,   // --> implementing paying convenience at very first transaction payment
                index: result.termins[0].number,
                token: false,
                termin_id: result.termins[0]._id
              };

              let bill = result.total;

              const auth = new Buffer(config.midtrans.server_key + ':' + '').toString('base64');
              // let order_id_creator = `PAYMENT-${result.transactionNumber}-${flags.index}`;
              let order_id_creator = `2-${result.transactionNumber}-${flags.index}`;
              
              // get card token if client didn't pass token property
              flags.token = getUserDefaultCard(userCards).token;
              // if no cards, then throw error
              if(!flags.token){
                // return next(new APIError(await sendCallback(merchant.callback, '209'), httpStatus.FORBIDDEN, true));
                // return res.json(await sendCallback(req.body, merchant.callback, '209', result._id, tl));
                room.connections.forEach(async (conn) => {
                  conn.value.send(JSON.stringify(responseMaker(false, 'createPayment', await sendCallback(body, merchant.callback, '209', preApprovedTransaction._id, tl))));
                });
                return;
              }


              // PAYMENT SECTION
              const dc = getUserDefaultCard(userCards);
              let initCharge;

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
                    "authentication_id": preApprovedTransaction.cardToken,
                    "amount": flags.nominal
                  }
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

                  // return res.json(await sendCallback(req.body, merchant.callback, '206', result._id, tl));
                  room.connections.forEach(async (conn) => {
                    conn.value.send(JSON.stringify(responseMaker(false, 'createPayment', await sendCallback(body, merchant.callback, '206', preApprovedTransaction._id, tl))));
                  });
                  return;
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
                      // token_id: flags.token,
                      token_id: preApprovedTransaction.cardToken,
                      save_token_id: true
                    }
                  }
                });

                // if cannot charging the card, throw an error
                if(initCharge.status_code !== '200' && initCharge.status_code !== '201'){
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
                  
                  // return res.json(await sendCallback(req.body, merchant.callback, '206', result._id, tl));
                  room.connections.forEach(async (conn) => {
                    conn.value.send(JSON.stringify(responseMaker(false, 'createPayment', await sendCallback(body, merchant.callback, '206', preApprovedTransaction._id, tl))));
                  });
                  return;
                }

                // approvedTransaction.termins[0].paid.status = true;
                result.termins[0].paid.status = true;
                result.termins[0].paid.status_code = initCharge.status_code;
                result.termins[0].paid.date = initCharge.transaction_time;
                result.termins[0].paid.method = initCharge.payment_type;
                result.termins[0].paid.payment_id = initCharge.transaction_id;
              }

              // change status
              result.status = 1;

              preApprovedTransaction.status = 1;
              preApprovedTransaction.pending = false;
              preApprovedTransaction.pgResponse = initCharge;

              // updating transaction
              // await result.save();
              await preApprovedTransaction.save();

              // await User.findOneAndUpdate({_id: user._id}, {$inc: {remainingCredit: -bill }}, {upsert: true, setDefaultsOnInsert: true})
              await User.findOneAndUpdate({_id: user._id}, {$inc: {remainingCredit: -bill }}, {upsert: true, setDefaultsOnInsert: true})
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
                  // return res.json(await sendCallback(req.body, merchant.callback, '210', result._id, tl));
                  room.connections.forEach(async (conn) => {
                    conn.value.send(JSON.stringify(responseMaker(false, 'createPayment', await sendCallback(body, merchant.callback, '210', preApprovedTransaction._id, tl))));
                  });
                  return;
                });

              userEmail.push({
                to: user.detail.email,
                subject: 'Transaksi Sukses',
                type: 'successTransactionUser',
                properties: {
                  clientName: user.detail.name,
                  storeName: merchant.name,
                  transactionNumber: result.transactionNumber,
                  createdAt : result.termins[0].paid.date,
                  total: preApprovedTransaction.total,
                  convenienceFee: cf.amount
                }
              });

              // send email of success transaction to merchant
              await TransactionNotification.update({ transactionNumber: preApprovedTransaction.transactionNumber }, {
                transactionNumber: preApprovedTransaction.transactionNumber,
                merchantEmail: {
                  sent: false,
                  detail: {
                    to: merchant.email,
                    subject: 'Transaksi Sukses',
                    type: 'successTransactionMerchant',
                    properties: {
                      name: merchant.name,
                      transactionNumber: result.transactionNumber,
                      createdAt : result.termins[0].paid.date,
                      amount: preApprovedTransaction.total,
                      user: name
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
                    body: `Pending payment ${result.transactionNumber} sebesar Rp ${preApprovedTransaction.total} (exc. biaya layaran Rp ${cf.amount})`
                  }
                }
              }, { upsert: true });

              // do shopify stuff here
              if(preApprovedTransaction.platform === 'shopify'){
                await TransactionNotification.update({transactionNumber: preApprovedTransaction.transactionNumber}, {
                  $set: {
                    merchantCallback: {
                      sent: false,
                      detail: preApprovedTransaction.callback,
                      response: []
                    }
                  }
                }, {upsert: true});

              // } if(merchant.callback){
              } else if(merchant.callback && preApprovedTransaction.platform !== 'shopify'){
                await TransactionNotification.update({transactionNumber: preApprovedTransaction.transactionNumber}, {
                  $set: {
                    merchantCallback: {
                      sent: false,
                      detail: {
                        uri: merchant.callback,
                        method: 'POST',
                        json: HelperFunctions.callbackMaker(body, preApprovedTransaction.total)
                      },
                      response: []
                    }
                  }
                }, {upsert: true});
              }

              // add to payment log
              let pl = new PaymentLog({
                status_code: '200',
                order_id: result.transactionNumber,
                transaction_id: result.transactionNumber,
                gross_amount: preApprovedTransaction.total,
                type: 2,
                user: user._id
              });
              await pl.save()
                .catch(async e => {
                  // return res.json(await sendCallback(req.body, '', '200', result._id, tl));
                  await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {status: 1, pending: false, pgResponse: initCharge}});

                  room.connections.forEach(async (conn) => {
                    conn.value.send(JSON.stringify(responseMaker(true, 'createPayment', HelperFunctions.callbackMaker(body))));
                  });
                  return;
                });

              // sending socket
              // const username = 'empatkali';
              // const password = encodeURIComponent('vH<tV@@E7w.X3cZS');
              // const ws = new WebSocket(`ws://${username}:${password}@127.0.0.1:4041/ws/approvedtransactions/store/${store}`);

              // ws.on('open', async function open() {
                // ws.send(JSON.stringify(await sendCallback(req.body, '', '200', result._id, tl)));
                // return ws.send(JSON.stringify(responseMaker(false, 'paymentPin', await sendCallback(req.body, merchant.callback, '210', result._id, tl))));
              // });

              // send callback to merchant
              // res.json(await sendCallback(req.body, merchant.callback, '200', result._id, tl));
              // await PreApprovedTransaction.findByIdAndUpdate(preApprovedTransaction._id, {$set: {status: 1, pending: false, pgResponse: initCharge}});

              // record the transaction
              await ApprovedTransaction.create(preApprovedTransaction.transactionBucket);

              requestFlag = '';

              // adding reward for referrer
              await HelperFunctions.giveVoucherForFirstTransaction(user);

              room.connections.forEach(async (conn) => {
                conn.value.send(JSON.stringify(responseMaker(true, 'createPayment', HelperFunctions.callbackMaker(body))));
              });
              return;
              // ########################################################


            } else{

              room.connections.forEach(async (conn) => {
                conn.value.send(JSON.stringify(responseMaker(false, 'createPayment', await sendCallback(body, '', '211', '', tl))));
              });
              return;
            }

          // } catch(e){
          //   console.log(`e: ${JSON.stringify(e)}`);

          //   room.connections.forEach(async (conn) => {
          //     conn.value.send(JSON.stringify(responseMaker(false, 'createPayment', await sendCallback(body, '', '210', '', tl))));
          //   });
          // }


        }



        break;

      case 'doneInit':
        /**
         * message
         * {
         *    type: 'doneInit',
         *    success: <Boolean>,
         *    detail: {
         *      transactionNumber: transactionNumber,
         *      gross_amount: <Number>,
         *      paymentType: <String>
         *    }
         * }
         */
        let ut = 'user';
        if(message.detail.store) ut = 'store';

        room.connections.forEach(conn => {
          if(conn.type === ut){
            let response = {
              type: 'doneInit',
              success: message.success,
              detail: message.detail
            };

            conn.value.send(JSON.stringify(response));
          }
        });

        break;

      case 'getCVV':
        /**
         * message
         * {
         *    type: 'getCVV',
         *    transactionNumber: transactionNumber,
         *    gross_amount: <Number>,
         *    card_cvv: <String>,
         *    token: <String>,
         *    redirectUrl: <String>
         * }
         */
        let mobileNumber = '';
        let passed = false;
        const paId = await PreApprovedTransaction.findOne({transactionNumber: message.transactionNumber});

        // if(message.transactionNumber && message.gross_amount && message.storeId && message.mobileNumber){
        if(message.transactionNumber && message.storeId && message.mobileNumber){
          if(message.storeId.toString() === paId.store.toString()){
            passed = true;
            mobileNumber = message.mobileNumber;
          }

        // } else if(message.transactionNumber && message.gross_amount && message.token){
        } else if(message.transactionNumber && message.token){
          
          const decodedToken = jwt.verify(message.token, config.userJwtSecret);

          if(decodedToken.dataToken){
            if(decodedToken.dataToken.mobileNumber && decodedToken.dataToken.mobileNumber === name){
              passed = true;
              mobileNumber = decodedToken.dataToken.mobileNumber;
            }
          }

        } else{
          return ws.send(JSON.stringify(responseMaker(false, 'getCVV', {message: 'one or more parameter(s) not found'})));
        }

        // continue the process
        const merchant = await Store.findById(paId.store)
          .populate({path: 'merchant', model: Merchant, select: 'convenienceFee'});

        // let cf = {amount: 10000};
        // if(merchant.merchant.convenienceFee) cf = {amount: merchant.merchant.convenienceFee};
        let cf, cftd = (paId.terminDuration === 14) ? 'twoWeekly' : 'monthly';
        if(merchant.merchant.convenienceFee){
          if(merchant.merchant.convenienceFee[cftd]){
              cf = {amount: merchant.merchant.convenienceFee[cftd]};
            } else{
              if(paId.terminDuration === 30 || paId.terminDuration === "30") cf = {amount: 25000};
              else cf = {amount: 0};
            }
        } else{
          if(paId.terminDuration === 30 || paId.terminDuration === "30") cf = {amount: 25000};
            else cf = {amount: 0};
        }

        if(passed){
          if(user.defaultPayment === 'dana'){
            let cardTokenz = await HelperFunctions.requester({
              url: `http://149.129.252.24/dana/createorder${(process.env.NODE_ENV === 'production') ? '-prod' : ''}.php`,
              qs: {
                trxid: `2-${message.transactionNumber}-1`,
                jml: Math.round(paId.total / 4) + cf.amount,
                hp: mobileNumber,
                redirect: message.redirectUrl
              },
              method: 'GET',
              headers: {
                'Content-Type': 'application/json'
              }
            }).catch(err => {
              return ws.send(JSON.stringify(responseMaker(false, 'getCVV', err)));
            });

            const cardToken = JSON.parse(cardTokenz);
            let tokenResponse = {
              redirect_url: cardToken.url
            };
            tokenResponse.paymentType = 'dana';
            
            // return res.json({redirect_url: cardToken.url});
            return ws.send(JSON.stringify(responseMaker(true, 'getCVV', {redirect_url: cardToken.url})));

          // CARD
          } else{


            const dc = getUserDefaultCard(userCards);
            let cardToken;

            if(dc.paymentGateway === 'xendit'){
              let cardTokenz = await HelperFunctions.requester({
                url: `${config.xendit.address}/credit_card_tokens/${dc.token}/authentications`,
                method: 'POST',
                json: {
                  "amount": Math.round(paId.total / 4) + cf.amount
                },
                headers: {
                  Authorization: `Basic ${new Buffer(config.xendit.public_key + ':' + '').toString('base64')}`,
                  'Content-Type': 'application/json'
                }
              }).catch(err => {
                return ws.send(JSON.stringify(responseMaker(false, 'getCVV', err)));
              });

              cardToken = {
                "status_code": "200",
                "status_message": "Credit card token is created as Token ID.",
                "token_id": cardTokenz.id,
                "bank": dc.bank,
                "hash": dc.masked,
                "redirect_url": cardTokenz.payer_authentication_url
              };

              // update token to pre approved transaction
              await PreApprovedTransaction.findOneAndUpdate({transactionNumber: message.transactionNumber}, {$set: {cardToken: cardToken.token_id}});

              if(!cardTokenz.error_code) return ws.send(JSON.stringify(responseMaker(true, 'getCVV', cardToken)));
              else return ws.send(JSON.stringify(responseMaker(false, 'getCVV', {message: cardTokenz.message})));

            } else{
              // if user didn't pass card cvv when transaction payment type is card, then throw error
              if(!message.card_cvv) return ws.send(JSON.stringify(responseMaker(false, 'getCVV', {message: 'one or more parameter(s) not found'})));

              let cardTokenz = await HelperFunctions.requester({
                url: config.midtrans.address + '/token',
                qs: {
                  client_key: config.midtrans.client_key,
                  gross_amount: Math.round(paId.total / 4) + cf.amount,
                  card_cvv: message.card_cvv,
                  token_id: dc.token,
                  secure: true
                },
                method: 'GET',
                headers: {
                  Authorization: `Basic ${new Buffer(config.midtrans.server_key + ':' + '').toString('base64')}`,
                  'Content-Type': 'application/json'
                }
              }).catch(err => {
                return ws.send(JSON.stringify(responseMaker(false, 'getCVV', err)));
              });

              cardToken = JSON.parse(cardTokenz);

              // update token to pre approved transaction
              await PreApprovedTransaction.findOneAndUpdate({transactionNumber: message.transactionNumber}, {$set: {cardToken: cardToken.token_id}});

            }

            if(cardToken.status_code === '200') return ws.send(JSON.stringify(responseMaker(true, 'getCVV', cardToken)));
            else return ws.send(JSON.stringify(responseMaker(false, 'getCVV', {message: 'failed in getting card token'})));
          }


        } else{
          return ws.send(JSON.stringify(responseMaker(false, 'getCVV', {message: 'you\'re not allowed here'})));
        }


        break;

      case 'successLoginDana':
        room.connections.forEach(conn => {
          if(conn.type === 'user'){
            let response = {
              type: 'successLoginDana',
              success: message.success,
              detail: message.detail
            };

            conn.value.send(JSON.stringify(response));
          }
        });
        break;

      case 'successTransactionWithDana':
        room.connections.forEach(conn => {
          // if(conn.type === 'user'){
            let response = {
              type: 'successTransactionWithDana',
              success: message.success,
              detail: message.detail
            };

            conn.value.send(JSON.stringify(response));
          // }
        });
        break;

      case 'successTransactionWithGopay':
        room.connections.forEach(conn => {
          // if(conn.type === 'user'){
            let response = {
              type: 'successTransactionWithGopay',
              success: message.success,
              detail: message.detail
            };

            conn.value.send(JSON.stringify(response));
          // }
        });
        break;

      default:
        ws.send(JSON.stringify(responseMaker(false, '', {message: 'nothing happened'})));
    }
  });


  ws.on('close', (client) => {
    console.log(`a client has been disconnected DONGGGGG, with room.connections.length: ${room.connections.length}`);
    clearInterval(looper);
    for(let i=0;i<room.connections.length;i++){
      if(room.connections[i]._id === ws.id){

        // clear interval first
        if(room.connections[i].type.toLowerCase() === 'user'){
          console.log(`CLEARING INTERVAL...`);
          clearInterval(looper);
        }

        room.connections.splice(i, 1);
        break;
      }
    }

    requestFlag = '';
  });
});







/**
 * Helper functions
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

function timeCreator(){
  const delay = 30;
  const start = moment();
  // const remainder = delay - (start.second() % delay);
  const dateTime = moment(start).add(delay, "seconds").valueOf();

  // return moment(start).add(remainder, "seconds").valueOf();
  return {
    time: moment(start).add(dateTime, "seconds").valueOf(),
    delay: delay
  }
}

async function userChecker(user){
  let flag = false;
  let conditions = {};

  if(/^08\d[0-9]{7,9}$/g.test(user)) conditions.mobileNumber = user;
  else conditions._id = user;

  await User.findOne(conditions);


}

async function dbChecker(type, _id){
  let flag = false;

  if(type === 'store'){
    if(await Store.findById(_id)) flag = true;
  } else{
    if(await User.findById(_id)) flag = true;
  }

  return flag;
}

function OTPCreator(){
  const mTime = timeCreator();
  let secret = speakeasy.generateSecret();
  let token = speakeasy.totp({
    secret: secret.base32,
    encoding: 'base32',
    time: mTime.time,
    delay: mTime.delay,
    digits: 4
  });

  return {
    secret: secret,
    otp: token,
    encoding: 'base32',
    timestamps: mTime.time,
    delay: mTime.delay,
    digits: 4
  };
}

function checkRoomReady(datas){
  let bucket = [];
  let success = false;
  
  datas.forEach((d) => {
    bucket.push(d.type);
  });

  return (bucket.indexOf('store') > -1 && bucket.indexOf('user') > -1) ? true : false;

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

function responseMaker(success, type, message){
  return {
    success: success,
    type: type,
    detail: message
  };
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
async function sendCallback(body, url, status, tid, log){
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
  //   await TransactionNotification.update({approvedTransactionId: tid}, {
  //     $set: {
  //       merchantCallback: {
  //         sent: false,
  //         detail: {
  //           uri: url,
  //           method: 'POST',
  //           json: addingCustomField(body, callbackMessage)
  //         }
  //       }
  //     }
  //   }, {upsert: true});
  // }

  // if(status !== '200'){
  //   const pat = await PreApprovedTransaction.findOne({transactionNumber: body.transactionNumber});

  //   if(pat.failedURL){
  //     await FailedTransactionNotification.create({
  //     transactionNumber: body.transactionNumber,
  //       merchantCallback: {
  //         sent: false,
  //         detail: {
  //           uri: pat.failedURL,
  //           method: 'POST',
  //           json: callbackMessage
  //         },
  //         response: []
  //       }
  //     });
  //   }
  // }

  // adding log
  log.status_code = status;
  await new TransactionLog(log).save();

  // return addingCustomField(body, callbackMessage);
  return callbackMessage;
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

    if(qrAssets.length > 5){
      let tmp, counter = 0;

      // parsing here
      try{
        
        for(let i=5;i<qrAssets.length;i++){
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

function isEmpty(obj) {
  for(var prop in obj) {
    if(obj.hasOwnProperty(prop)) {
      return false;
    }
  }

  return JSON.stringify(obj) === JSON.stringify({});
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






module.exports = router;
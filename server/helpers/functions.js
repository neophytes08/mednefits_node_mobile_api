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
  if(body.redirectURL) bucket.redirectURL = body.redirectURL;
  if(body.convenienceFee) bucket.convenienceFee = body.convenienceFee;
  if(body.terminDuration) bucket.terminDuration = body.terminDuration;

  let keys = Object.keys(body);

  let counter = 0;
  
  for(let i=0;i<keys.length;i++){
    if(counter < 5){
      if(keys[i] !== 'transactionNumber' && keys[i] !== 'total' && keys[i] !== 'amount' && keys[i] !== 'store' && keys[i] !== 'md5' && keys[i] !== 'token' && keys[i] !== 'terminDuration' && keys[i] !== 'convenienceFee'){
        bucket[keys[i]] = body[keys[i]];
        ++counter;
      }
    }
  }

  return bucket;
}

async function broadcaster(type, mn, success, detail){
  const socket = require('socket.io-client')();

  socket.on('connect', () => {
    socket.emit(type, { mn, detail });
    socket.close();
  });
  
  return;
}




module.exports = {
  callbackMakerAdv,
  broadcaster
}
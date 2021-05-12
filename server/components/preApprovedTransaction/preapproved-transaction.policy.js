const Merchant = require('../merchant/merchant.model');
const Store = require('../store/store.model');
const APIError = require('../../helpers/APIError');
const aclModule = require('acl');
let acl = aclModule;

// Using the memory backend
acl = new acl(new acl.memoryBackend());


function invokeRolesPolicies(){
  acl.allow([
    {
      roles: ['admin', 'store'],
      allows: [{
        resources: '/api/preapprovedtransactions/',
        permissions: ['get']
      }]
    }
  ]);
}

async function isAllowed(req, res, next) {
  const userData = req.user;
  let roles = ['unknown'];

  // looking for user's type
  if(userData.isMerchant){
    if(await Merchant.findById(userData._id)) roles = ['admin'];
  } else{
    if(await Store.findById(userData._id)) roles = ['store'];
  }
  console.log(`ROLES: ${JSON.stringify(roles)}`);

  let isAllowed = await acl.areAnyRolesAllowed(roles, req.baseUrl + req.path, req.method.toLowerCase())
      .catch((err) => {
        return res.status(500).json({message: 'Unexpected authorization error'});
      });

  if(isAllowed){
    return next();
  } else{
    return res.status(403).json({
      message: 'User is not authorized'
    });
  }
};

module.exports = { invokeRolesPolicies, isAllowed } ;
const Promise = require('bluebird');
const mongoose = require('mongoose');
const httpStatus = require('http-status');
const config = require('../../../config/config');
const APIError = require('../../helpers/APIError');



/**
 * User Schema
 *
 * We got some status here for the users
 * 0 -> unknown
 * 1 -> activating
 * 2 -> transaction
 * 3 -> banning
 * 4 -> admin
 * 5 -> update user balance
 */
const UserSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.ObjectId,
    ref: 'Admin'
  },
  user: {
    type: mongoose.Schema.ObjectId,
    required: 'Please fill in user / client id',
    ref: 'User'
  },
  read: {
    type: Boolean,
    default: false,
    required: true
  },
  status: {
    type: Number,
    required: 'Please fill in type',
    default: 0
  },
  title: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  }
}, { timestamps: true, runSettersOnQuery: true });


/**
 * Add your
 * - pre-save hooks
 * - validations
 * - virtuals
 */

/**
 * Methods
 */
UserSchema.method({
});

/**
 * Statics
 */
UserSchema.statics = {
  /**
   * Get user
   * @param {ObjectId} id - The objectId of user.
   * @returns {Promise<User, APIError>}
   */
  get(id) {
    return this.findById(id)
      .exec()
      .then((user) => {
        if (user) {
          return user;
        }
        const err = new APIError('No such user exists!', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },

  /**
   * List users in descending order of 'createdAt' timestamp.
   * @param {number} skip - Number of users to be skipped.
   * @param {number} limit - Limit number of users to be returned.
   * @returns {Promise<User[]>}
   */
  list({ skip = 0, limit = 50, user = '' } = {}) {
    return this.find({user: user, status: {$nin: [1, 6]}})
      .sort({ createdAt: -1 })
      .skip(+skip)
      .limit(+limit)
      .exec();
  }
};

/**
 * @typedef User
 */
module.exports = mongoose.connection.useDb(config.mongo.user_host).model('UserLog', UserSchema);

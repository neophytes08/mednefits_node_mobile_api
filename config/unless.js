const unlessJwt = {
  basicAuth: {
    path: [
      { url: '/api/auth/random-number', methods: ['GET'] },
      { url: '/api/health-check', methods: ['GET'] }
    ],
  },
  jwt: {
    path: [
      { url: '/api/auth/random-number', methods: ['GET'] },
      { url: '/api/health-check', methods: ['GET'] }
    ],
  },
};

module.exports = unlessJwt;
